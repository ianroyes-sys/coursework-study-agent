import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hydrate, type Course, type ItemState, type RawItem } from "@/lib/coursework";
import {
  COURSEWORK_PREP_POLICY,
  prepPolicy,
  type CourseworkPrepData,
  type CourseworkReviewState,
  type CourseworkSource,
  type PrepArtifact,
  type PrepManifest,
  type PrepManifestItem,
  type ReviewStatus,
} from "@/lib/courseworkPrep";

import { ARTIFACT_ROOT, COURSEWORK_FILE, DATA_DIR, PREP_MANIFEST_FILE, REVIEW_STATE_FILE, STATE_FILE } from "@/lib/server/paths";

const DATA = COURSEWORK_FILE;
const COURSEWORK_STATE = STATE_FILE;
export const PREP_MANIFEST = PREP_MANIFEST_FILE;
export const REVIEW_STATE = REVIEW_STATE_FILE;

type CourseworkFile = { courses?: Course[]; items?: RawItem[]; sources?: Record<string, CourseworkSource> };
type ReviewMap = Record<string, CourseworkReviewState>;

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; }
}

export function atomicJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function emptyManifest(): PrepManifest {
  return { version: 1, updatedAt: new Date().toISOString(), policy: COURSEWORK_PREP_POLICY, items: {} };
}

export function sourceFingerprint(item: RawItem, source: CourseworkSource | null): string {
  return crypto.createHash("sha256").update(JSON.stringify({
    id: item.id, course: item.course, type: item.type, title: item.title, due: item.due,
    points: item.points, weightPct: item.weightPct, url: item.url, note: item.note, source,
  })).digest("hex");
}

function safeArtifact(manifestItem: PrepManifestItem): PrepArtifact | null {
  if (!manifestItem.artifactPath) return null;
  const root = ARTIFACT_ROOT;
  const target = path.resolve(DATA_DIR, manifestItem.artifactPath);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  const artifact = readJson<PrepArtifact | null>(target, null);
  return artifact?.courseworkId === manifestItem.courseworkId ? artifact : null;
}

export function reconcilePrep(): PrepManifest {
  const coursework = readJson<CourseworkFile>(DATA, {});
  const personal = readJson<Record<string, ItemState>>(COURSEWORK_STATE, {});
  const current = readJson<PrepManifest>(PREP_MANIFEST, emptyManifest());
  const active = new Set((coursework.items ?? []).map((item) => item.id));
  const next: PrepManifest = { ...current, version: 1, policy: COURSEWORK_PREP_POLICY, updatedAt: new Date().toISOString(), items: {} };
  for (const item of coursework.items ?? []) {
    const old = current.items?.[item.id];
    const fingerprint = sourceFingerprint(item, coursework.sources?.[item.id] ?? null);
    const completed = ["done", "skipped", "expired"].includes(personal[item.id]?.status ?? "todo");
    const status = old && old.sourceFingerprint !== fingerprint && old.status === "ready" ? "stale" : (old?.status ?? "queued");
    next.items[item.id] = {
      courseworkId: item.id,
      course: item.course,
      sourceFingerprint: fingerprint,
      status: completed && !old ? "blocked" : status,
      currentRevision: old?.currentRevision ?? 0,
      artifactPath: old?.artifactPath ?? null,
      generatedAt: old?.generatedAt ?? null,
      blocker: completed && !old ? { code: "complete", message: "Already marked complete in Coursework." } : (old?.blocker ?? null),
    };
  }
  for (const id of Object.keys(current.items ?? {})) if (!active.has(id)) delete next.items[id];
  atomicJson(PREP_MANIFEST, next);
  return next;
}

const defaultReview = (): CourseworkReviewState => ({ status: "pending", reviewedAt: null, note: "", revisionRequestedAt: null });

export function readPrepData(): CourseworkPrepData {
  const coursework = readJson<CourseworkFile>(DATA, {});
  const personal = readJson<Record<string, ItemState>>(COURSEWORK_STATE, {});
  const manifest = reconcilePrep();
  const reviews = readJson<ReviewMap>(REVIEW_STATE, {});
  const courses = new Map((coursework.courses ?? []).map((course) => [course.short, course]));
  const items = hydrate(coursework.items ?? [], personal).map((item) => {
    const source = coursework.sources?.[item.id] ?? null;
    const policy = prepPolicy(item, source);
    return {
      item,
      course: courses.get(item.course) ?? null,
      source,
      manifest: manifest.items[item.id],
      artifact: safeArtifact(manifest.items[item.id]),
      review: reviews[item.id] ?? defaultReview(),
      policyReason: policy.reason,
      aiProhibited: policy.aiProhibited,
      gradedEvidence: policy.gradedEvidence,
    };
  });
  return {
    found: Boolean(coursework.items?.length),
    policy: COURSEWORK_PREP_POLICY,
    updatedAt: manifest.updatedAt,
    counts: {
      ready: items.filter((x) => ["ready", "stale"].includes(x.manifest.status) && x.review.status !== "reviewed").length,
      working: items.filter((x) => ["queued", "working"].includes(x.manifest.status)).length,
      blocked: items.filter((x) => x.manifest.status === "blocked").length,
      reviewed: items.filter((x) => x.review.status === "reviewed").length,
      needsRevision: items.filter((x) => x.review.status === "needs-revision").length,
    },
    items,
  };
}

export function updateReview(id: string, status: ReviewStatus, note: string) {
  const coursework = readJson<CourseworkFile>(DATA, {});
  if (!coursework.items?.some((item) => item.id === id)) throw new Error("unknown-item");
  const reviews = readJson<ReviewMap>(REVIEW_STATE, {});
  const now = new Date().toISOString();
  reviews[id] = {
    status,
    note: note.replace(/\r/g, "").trim().slice(0, 4000),
    reviewedAt: status === "reviewed" ? now : null,
    revisionRequestedAt: status === "needs-revision" ? now : null,
  };
  atomicJson(REVIEW_STATE, reviews);
  return reviews[id];
}
