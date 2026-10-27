import type { Course, Item } from "@/lib/coursework";

export const COURSEWORK_PREP_POLICY = "prep-only-no-submission" as const;

export type PrepStatus = "queued" | "working" | "ready" | "blocked" | "stale";
export type ReviewStatus = "pending" | "reviewed" | "needs-revision" | "dismissed";
export type PrepKind = "study-guide" | "answer-draft" | "outline" | "research-notes" | "quiz-prep";

export type CourseworkSource = {
  capturedAt: string;
  instructions: string;
  description: string;
  attachments: string[];
  gradeItemId: string | null;
  possiblePoints: number | null;
  autoExportToGrades: boolean | null;
  attemptsAllowed: number | "unlimited" | null;
  timeLimitMinutes: number | null;
};

export type PrepManifestItem = {
  courseworkId: string;
  course: string;
  sourceFingerprint: string;
  status: PrepStatus;
  currentRevision: number;
  artifactPath: string | null;
  generatedAt: string | null;
  blocker: { code: string; message: string } | null;
};

export type PrepManifest = {
  version: 1;
  updatedAt: string;
  policy: typeof COURSEWORK_PREP_POLICY;
  items: Record<string, PrepManifestItem>;
};

export type PrepArtifact = {
  schemaVersion: 1;
  courseworkId: string;
  revision: number;
  kind: PrepKind;
  createdAt: string;
  sourceSnapshot: {
    title: string;
    course: string;
    type: string;
    due: string | null;
    url: string;
    prompt: string | null;
  };
  summary: string;
  proposedResponse: string;
  reasoning: string[];
  selfCheck: string[];
  sources: { label: string; url: string; supports: string }[];
  uncertainties: string[];
  officeHoursQuestions: string[];
  confidence: "high" | "medium" | "low";
  notice: string;
};

export type CourseworkReviewState = {
  status: ReviewStatus;
  reviewedAt: string | null;
  note: string;
  revisionRequestedAt: string | null;
};

export type PrepItem = {
  item: Item;
  course: Course | null;
  source: CourseworkSource | null;
  manifest: PrepManifestItem;
  artifact: PrepArtifact | null;
  review: CourseworkReviewState;
  policyReason: string;
  aiProhibited: boolean;
  gradedEvidence: boolean;
};

export type CourseworkPrepData = {
  found: boolean;
  policy: typeof COURSEWORK_PREP_POLICY;
  updatedAt: string | null;
  counts: { ready: number; working: number; blocked: number; reviewed: number; needsRevision: number };
  items: PrepItem[];
};

export function sourceText(source: CourseworkSource | null): string {
  return [source?.instructions, source?.description].filter(Boolean).join("\n\n").trim();
}

export function prepPolicy(item: Item, source: CourseworkSource | null) {
  const material = `${item.title}\n${item.note}\n${sourceText(source)}`;
  const aiProhibited = /(?:do (?:their|your) own work|ai (?:platform|generated|tools?).{0,80}(?:not|prohibit|forbid)|without (?:using )?ai)/i.test(material);
  const gradedEvidence = Boolean(
    source?.gradeItemId
      || source?.autoExportToGrades
      || (source?.possiblePoints ?? item.points ?? 0) > 0
      || item.weightPct,
  );
  const timed = item.type === "quiz" || item.type === "exam" || source?.timeLimitMinutes != null || source?.attemptsAllowed === 1;
  if (aiProhibited) return { aiProhibited, gradedEvidence, kind: "study-guide" as PrepKind, reason: "The course instructions require your own work and restrict AI-generated responses. Study support only." };
  if (timed) return { aiProhibited, gradedEvidence, kind: "quiz-prep" as PrepKind, reason: "Timed or attempt-based assessment. The agent prepares review material but never starts or answers the attempt." };
  if (gradedEvidence) return { aiProhibited, gradedEvidence, kind: "outline" as PrepKind, reason: "Brightspace links this item to points or the gradebook. The agent prepares an outline for your review, not a submission." };
  if (/\b(practice|self[- ]assessment|review|flashcards?)\b/i.test(material)) return { aiProhibited, gradedEvidence, kind: "answer-draft" as PrepKind, reason: "The source explicitly labels this as practice/review work. A draft may be prepared for your review." };
  return { aiProhibited, gradedEvidence, kind: "study-guide" as PrepKind, reason: "Grading status is not provably ungraded. It defaults to study support." };
}
