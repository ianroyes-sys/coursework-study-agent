import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import type { Course, DueSource, ItemType, RawItem } from "@/lib/coursework";
import type { CourseworkSource } from "@/lib/courseworkPrep";
import { COURSEWORK_FILE } from "@/lib/server/paths";

const execFileAsync = promisify(execFile);

/** Your Brightspace tenant, e.g. https://yourschool.desire2learn.com (no trailing slash). */
const D2L_BASE_URL = (process.env.D2L_BASE_URL || "").replace(/\/+$/, "");
const D2L_HOST = D2L_BASE_URL.replace(/^https?:\/\//, "");
/** API versions your tenant reports at `/d2l/api/versions/`. */
const LE_VERSION = process.env.D2L_LE_VERSION || "1.96";
const LP_VERSION = process.env.D2L_LP_VERSION || "1.62";
/** Discussion topics that are housekeeping, not coursework (comma-separated, case-insensitive). */
const SKIP_TOPICS = (process.env.D2L_SKIP_TOPICS ?? "Questions").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const DATA = COURSEWORK_FILE;
const COURSE_COLORS = ["#9ad8ff", "#c4b5fd", "#ffc861", "#7ef0b2", "#ff8a7a", "#e879f9"];

type ScrapedFile = {
  _edit?: string;
  generatedAt?: string;
  term?: string;
  termStart?: string;
  termEnd?: string;
  courses?: Course[];
  items?: RawItem[];
  gaps?: string[];
  sources?: Record<string, CourseworkSource>;
};

type LiveCourse = {
  dropboxes?: unknown;
  quizzes?: unknown;
  forums?: unknown;
  topics?: Record<string, unknown>;
  grades?: unknown;
  toc?: unknown;
  news?: unknown;
  errors?: string[];
};

type Enrollment = {
  OrgUnit?: {
    Id?: number;
    Type?: { Code?: string };
    Name?: string;
    Code?: string;
    HomeUrl?: string | null;
  };
  Access?: {
    IsActive?: boolean;
    CanAccess?: boolean;
    StartDate?: string | null;
    EndDate?: string | null;
  };
};

type LiveD2L = {
  enrollments: Enrollment[];
  courses: Record<string, LiveCourse>;
};

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function list(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object");
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  for (const key of ["Objects", "Items", "Results", "Value", "Forums", "Topics", "GradeObjects"]) {
    if (Array.isArray(object[key])) return list(object[key]);
  }
  return [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstText(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return "";
}

function firstId(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = number(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function nestedText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  return nestedText(object.Text) || nestedText(object.Html);
}

function sourceSnapshots(course: Course, live: LiveCourse, capturedAt: string): Record<string, CourseworkSource> {
  const result: Record<string, CourseworkSource> = {};
  const add = (entry: Record<string, unknown>, prefix: "a" | "q" | "d") => {
    const externalId = firstId(entry, prefix === "a" ? ["Id", "FolderId"] : prefix === "q" ? ["QuizId", "Id"] : ["TopicId", "Id"]);
    if (!externalId) return;
    const assessment = entry.Assessment && typeof entry.Assessment === "object" ? entry.Assessment as Record<string, unknown> : {};
    const attempts = entry.AttemptsAllowed && typeof entry.AttemptsAllowed === "object" ? entry.AttemptsAllowed as Record<string, unknown> : {};
    const limit = entry.SubmissionTimeLimit && typeof entry.SubmissionTimeLimit === "object" ? entry.SubmissionTimeLimit as Record<string, unknown> : {};
    const attachments = Array.isArray(entry.Attachments) ? entry.Attachments : [];
    result[`${course.short.toLowerCase()}-${prefix}${externalId}`] = {
      capturedAt,
      instructions: nestedText(entry.CustomInstructions) || nestedText(entry.Instructions),
      description: nestedText(entry.Description),
      attachments: attachments.flatMap((value) => value && typeof value === "object" ? [firstText(value as Record<string, unknown>, ["FileName", "Name"])] : []).filter(Boolean),
      gradeItemId: firstId(entry, ["GradeItemId", "GradeObjectId"]) || null,
      possiblePoints: firstNumber(assessment, ["ScoreDenominator", "MaxPoints"]) ?? firstNumber(entry, ["MaxPoints", "PossiblePoints", "Points"]),
      autoExportToGrades: typeof entry.AutoExportToGrades === "boolean" ? entry.AutoExportToGrades : null,
      attemptsAllowed: attempts.IsUnlimited === true ? "unlimited" : firstNumber(attempts, ["NumberOfAttemptsAllowed"]),
      timeLimitMinutes: limit.IsEnforced === true ? firstNumber(limit, ["TimeLimitValue"]) : null,
    };
  };
  for (const entry of list(live.dropboxes)) add(entry, "a");
  for (const entry of list(live.quizzes)) add(entry, "q");
  for (const topics of Object.values(live.topics ?? {})) for (const entry of list(topics)) add(entry, "d");
  return result;
}

function validDate(value: unknown, termStart: string, termEnd: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  const start = new Date(termStart);
  const end = new Date(termEnd);
  if (Number.isNaN(date.getTime()) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (date.getTime() < start.getTime() || date.getTime() > end.getTime()) return null;
  return date.toISOString();
}

function normalizeId(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function sourceDate(source: Record<string, unknown>, termStart: string, termEnd: string): { due: string | null; dueSource: DueSource | null; opens: string | null; confidence: "high" | "low"; note: string } {
  const due = validDate(source.DueDate ?? source.dueDate, termStart, termEnd);
  if (due) return { due, dueSource: "d2l-duedate", opens: validDate(source.StartDate ?? source.startDate, termStart, termEnd), confidence: "high", note: "Live Brightspace due date." };

  const end = validDate(source.EndDate ?? source.endDate ?? source.AvailabilityEndDate, termStart, termEnd);
  if (end) {
    const isTopic = "TopicId" in source || "topicId" in source;
    return {
      due: end,
      dueSource: isTopic ? "d2l-topic-end" : "d2l-availability-end",
      opens: validDate(source.StartDate ?? source.startDate ?? source.AvailabilityStartDate, termStart, termEnd),
      confidence: "high",
      note: isTopic ? "Live Brightspace discussion/topic close date." : "Live Brightspace availability close date.",
    };
  }

  const rawDue = text(source.DueDate ?? source.dueDate ?? source.EndDate ?? source.endDate ?? source.AvailabilityEndDate);
  return {
    due: null,
    dueSource: null,
    opens: validDate(source.StartDate ?? source.startDate, termStart, termEnd),
    confidence: "low",
    note: rawDue
      ? `Brightspace contains an out-of-term date (${rawDue.slice(0, 10)}); it was rejected rather than shown as a current-term deadline.`
      : "Published in Brightspace without a current due date.",
  };
}

function liveItems(course: Course, live: LiveCourse, termStart: string, termEnd: string): RawItem[] {
  const prefix = course.short.toLowerCase();
  const items: RawItem[] = [];
  const push = (entry: Record<string, unknown>, type: ItemType, idPrefix: string, fallbackUrl: string) => {
    const title = firstText(entry, ["Name", "Title", "TopicTitle", "GradeObjectName"]);
    const externalId = firstId(entry, ["Id", "FolderId", "QuizId", "TopicId", "GradeObjectId"]) || normalizeId(title);
    if (!title || !externalId) return;
    if (type === "discussion" && SKIP_TOPICS.includes(title.toLowerCase())) return;
    const date = sourceDate(entry, termStart, termEnd);
    items.push({
      id: `${prefix}-${idPrefix}${externalId}`,
      course: course.short,
      type,
      title,
      due: date.due,
      dueSource: date.dueSource,
      opens: date.opens,
      points: firstNumber(entry, ["MaxPoints", "PossiblePoints", "Points"]),
      weightPct: null,
      url: fallbackUrl,
      confidence: date.confidence,
      note: date.note,
    });
  };

  for (const entry of list(live.dropboxes)) push(entry, "assignment", "a", `${course.url}/dropbox`);
  for (const entry of list(live.quizzes)) push(entry, "quiz", "q", `${course.url}/quizzes`);
  for (const topics of Object.values(live.topics ?? {})) {
    for (const entry of list(topics)) push(entry, "discussion", "d", `${course.url}/discussions/List`);
  }

  return items;
}

function displayCode(code: string): string {
  const match = code.match(/^([A-Z]+)(\d+)_([^_]+)_/i);
  return match ? `${match[1].toUpperCase()} ${match[2]}-${match[3].toUpperCase()}` : code.replace(/_/g, " ");
}

function shortCode(code: string): string {
  return code.split("_")[0]?.toUpperCase() || normalizeId(code).toUpperCase();
}

/**
 * Many D2L tenants end course-offering codes with a term tag such as `_FALL_26`. Set
 * `D2L_TERM_SUFFIX` if yours uses a different convention; otherwise it is derived from the date.
 */
function currentTermSuffix(now = new Date()): string {
  if (process.env.D2L_TERM_SUFFIX) return process.env.D2L_TERM_SUFFIX.toUpperCase();
  const month = now.getMonth() + 1;
  const season = month <= 5 ? "SPRING" : month <= 7 ? "SUMMER" : "FALL";
  return `_${season}_${String(now.getFullYear()).slice(-2)}`;
}

function activeCourses(enrollments: Enrollment[]): Enrollment[] {
  const suffix = currentTermSuffix();
  return enrollments.filter((entry) => {
    const org = entry.OrgUnit;
    const access = entry.Access;
    return org?.Type?.Code === "Course Offering"
      && text(org.Code).toUpperCase().endsWith(suffix)
      && access?.IsActive === true
      && access?.CanAccess === true;
  });
}

function mergeCourses(current: Course[], enrollments: Enrollment[]): Course[] {
  const byId = new Map(current.map((course) => [course.d2lId, course]));
  return enrollments.flatMap((entry, index) => {
    const org = entry.OrgUnit;
    if (!org?.Id || !org.Code || !org.Name) return [];
    const existing = byId.get(org.Id);
    return [{
      short: shortCode(org.Code),
      code: displayCode(org.Code),
      title: org.Name,
      d2lId: org.Id,
      meets: existing?.meets ?? "See Brightspace",
      color: existing?.color ?? COURSE_COLORS[index % COURSE_COLORS.length],
      instructor: existing?.instructor ?? null,
      url: org.HomeUrl || `${D2L_BASE_URL}/d2l/home/${org.Id}`,
      gradeWeights: existing?.gradeWeights ?? [],
      syllabusNote: existing?.syllabusNote ?? "Newly detected from the live enrollment roster. Brightspace dates are included; syllabus and external-tool dates still need confirmation.",
    }];
  });
}

function gradebookOnlyItems(course: Course, live: LiveCourse, represented: RawItem[]): RawItem[] {
  const representedTitles = new Set(represented.map((item) => normalizeId(item.title)));
  const representedGradeIds = new Set([
    ...list(live.dropboxes),
    ...list(live.quizzes),
    ...Object.values(live.topics ?? {}).flatMap(list),
  ].map((entry) => firstId(entry, ["GradeItemId", "GradeObjectId"])).filter(Boolean));
  const prefix = course.short.toLowerCase();
  return list(live.grades).flatMap((entry) => {
    const title = firstText(entry, ["Name", "GradeObjectName"]);
    const id = firstId(entry, ["Id", "GradeObjectId"]);
    if (!title || !id || representedGradeIds.has(id) || representedTitles.has(normalizeId(title))) return [];
    const lowered = title.toLowerCase();
    const type: ItemType = /final|exam|test/.test(lowered)
      ? "exam"
      : /quiz|assessment/.test(lowered)
        ? "quiz"
        : /discussion/.test(lowered)
          ? "discussion"
          : /project|presentation/.test(lowered)
            ? "project"
            : /read|learn it/.test(lowered)
              ? "reading"
              : "assignment";
    return [{
      id: `${prefix}-g${id}`,
      course: course.short,
      type,
      title,
      due: null,
      dueSource: null,
      opens: null,
      points: firstNumber(entry, ["MaxPoints", "PossiblePoints", "Points"]),
      weightPct: null,
      url: `${course.url}/grades`,
      confidence: "low" as const,
      note: "Brightspace gradebook item without a current dated assignment object. Confirm its due date in the course syllabus or linked external platform.",
    }];
  });
}

function appleScript(browser: "Opera" | "Google Chrome", source: string) {
  const escaped = source.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
  const label = browser === "Opera" ? "Opera" : "Chrome";
  return `tell application "${browser}"\n` +
    `  if (count of windows) is 0 then error "${label} has no open windows. Open your signed-in Brightspace tab in ${label}, then try again."\n` +
    `  set targetTab to missing value\n` +
    `  repeat with theWindow in windows\n` +
    `    repeat with theTab in tabs of theWindow\n` +
    `      if URL of theTab contains "${D2L_HOST}" then\n` +
    `        set targetTab to theTab\n` +
    `        exit repeat\n` +
    `      end if\n` +
    `    end repeat\n` +
    `    if targetTab is not missing value then exit repeat\n` +
    `  end repeat\n` +
    `  if targetTab is missing value then error "Open your signed-in Brightspace tab in ${label}, then try again."\n` +
    `  return execute targetTab javascript "${escaped}"\n` +
    `end tell`;
}

async function browserJavascript(source: string) {
  const failures: string[] = [];
  for (const browser of ["Opera", "Google Chrome"] as const) {
    // `tell application` launches a closed browser; a refresh must never open apps on its own.
    try {
      await execFileAsync("pgrep", ["-xq", browser], { timeout: 5_000 });
    } catch {
      failures.push(`${browser === "Opera" ? "Opera" : "Chrome"} is not running. Open your signed-in Brightspace tab, then try again.`);
      continue;
    }
    try {
      const { stdout } = await execFileAsync("osascript", ["-e", appleScript(browser, source)], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
      if (stdout.trim()) return stdout.trim();
      failures.push(`${browser} returned no scriptable tab response.`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(failures.join(" "));
}

async function getLiveD2L(): Promise<LiveD2L> {
  const start = `(() => {\n` +
    `  const read = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); };\n` +
    `  window.__courseworkRefresh = { status: 'loading' };\n` +
    `  (async () => {\n` +
    `    const enrollmentData = await read('/d2l/api/lp/${LP_VERSION}/enrollments/myenrollments/?pageSize=200');\n` +
    `    const enrollments = enrollmentData.Items || enrollmentData.Objects || [];\n` +
    `    const suffix = '${currentTermSuffix()}';\n` +
    `    const active = enrollments.filter(x => x.OrgUnit && x.OrgUnit.Type && x.OrgUnit.Type.Code === 'Course Offering' && String(x.OrgUnit.Code || '').toUpperCase().endsWith(suffix) && x.Access && x.Access.IsActive && x.Access.CanAccess);\n` +
    `    const result = {};\n` +
    `    for (const enrollment of active) {\n` +
    `      const id = enrollment.OrgUnit.Id;\n` +
    `      const root = '/d2l/api/le/${LE_VERSION}/' + id;\n` +
    `      const [dropboxes, quizzes, forums, grades, toc, news] = await Promise.allSettled([read(root + '/dropbox/folders/'), read(root + '/quizzes/'), read(root + '/discussions/forums/'), read(root + '/grades/'), read(root + '/content/toc'), read(root + '/news/')]);\n` +
    `      const forumData = forums.status === 'fulfilled' ? forums.value : [];\n` +
    `      const forumList = Array.isArray(forumData) ? forumData : (forumData.Objects || forumData.Forums || []);\n` +
    `      const topics = {};\n` +
    `      await Promise.all(forumList.map(async (forum) => { try { topics[String(forum.ForumId || forum.Id)] = await read(root + '/discussions/forums/' + (forum.ForumId || forum.Id) + '/topics/'); } catch (e) { topics[String(forum.ForumId || forum.Id)] = []; } }));\n` +
    `      result[String(id)] = { dropboxes: dropboxes.status === 'fulfilled' ? dropboxes.value : [], quizzes: quizzes.status === 'fulfilled' ? quizzes.value : [], forums: forumData, grades: grades.status === 'fulfilled' ? grades.value : [], toc: toc.status === 'fulfilled' ? toc.value : {}, news: news.status === 'fulfilled' ? news.value : [], topics, errors: [dropboxes, quizzes, forums, grades, toc, news].filter(x => x.status === 'rejected').map(x => String(x.reason)) };\n` +
    `    }\n` +
    `    window.__courseworkRefresh = { status: 'ready', data: { enrollments: active, courses: result } };\n` +
    `  })().catch(error => { window.__courseworkRefresh = { status: 'error', error: String(error) }; });\n` +
    `  return 'started';\n` +
    `})()`;

  await browserJavascript(start);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const payload = await browserJavascript("JSON.stringify(window.__courseworkRefresh || { status: 'missing' })");
    const result = JSON.parse(payload) as { status?: string; data?: LiveD2L; error?: string };
    if (result.status === "ready" && result.data) return result.data;
    if (result.status === "error") throw new Error(result.error || "Brightspace refresh failed.");
  }
  throw new Error("Brightspace took too long to respond. Keep the D2L tab open and try again.");
}

export async function refreshCourseworkFromBrowser() {
  if (!D2L_BASE_URL) throw new Error("Set D2L_BASE_URL to your Brightspace tenant URL (see the env example file), then restart.");
  if (process.platform !== "darwin") throw new Error("Live refresh drives a signed-in Chrome or Opera tab through AppleScript, so it only runs on macOS. Use the manual flow in docs/scrape-d2l.md instead.");
  const current = readJson<ScrapedFile>(DATA, {});
  if (!current.courses?.length || !current.items) throw new Error("Coursework data is not initialized yet.");

  const live = await getLiveD2L();
  const enrollments = activeCourses(live.enrollments);
  if (!enrollments.length) throw new Error("Brightspace did not return any active courses for the current term. Nothing was changed.");
  const received = Object.values(live.courses).filter((course) => Object.keys(course).length > 0).length;
  if (received !== enrollments.length) throw new Error("Brightspace did not return every active course shell. Nothing was changed.");

  const courses = mergeCourses(current.courses, enrollments);
  const activeShorts = new Set(courses.map((course) => course.short));
  const originalStable = current.items.filter((item) => activeShorts.has(item.course)
    && (item.dueSource === "syllabus" || item.dueSource === "inferred" || /-g\d+$/.test(item.id)));
  const starts = enrollments.map((entry) => entry.Access?.StartDate).filter((value): value is string => !!value).sort();
  const ends = enrollments.map((entry) => entry.Access?.EndDate).filter((value): value is string => !!value).sort();
  const termStart = starts[0] ?? `${current.termStart}T00:00:00.000Z`;
  const termEnd = ends.at(-1) ?? `${current.termEnd}T23:59:59.999Z`;
  const liveCandidates = courses
    .flatMap((course) => liveItems(course, live.courses[String(course.d2lId)] ?? {}, termStart, termEnd));
  const liveConfirmedIds = new Set(liveCandidates.filter((item) => item.due).map((item) => item.id));
  const stable = originalStable.filter((item) => !liveConfirmedIds.has(item.id));
  const stableIds = new Set(stable.map((item) => item.id));
  const dynamic = liveCandidates.filter((item) => !stableIds.has(item.id));
  const represented = [...stable, ...dynamic];
  const representedIds = new Set(represented.map((item) => item.id));
  const gradebookOnly = courses
    .flatMap((course) => gradebookOnlyItems(
      course,
      live.courses[String(course.d2lId)] ?? {},
      represented.filter((item) => item.course === course.short),
    ))
    .filter((item) => !representedIds.has(item.id));
  const activeCodes = new Set(courses.map((course) => course.code));
  const capturedAt = new Date().toISOString();
  const liveSources = Object.assign({}, ...courses.map((course) => sourceSnapshots(course, live.courses[String(course.d2lId)] ?? {}, capturedAt)));
  const activeItemIds = new Set([...stable, ...dynamic, ...gradebookOnly].map((item) => item.id));
  const sources = Object.fromEntries(
    Object.entries({ ...(current.sources ?? {}), ...liveSources }).filter(([id]) => activeItemIds.has(id)),
  ) as Record<string, CourseworkSource>;
  const next: ScrapedFile = {
    ...current,
    _edit: "Refreshed from live Brightspace. Syllabus-derived items are preserved; personal progress remains in coursework-state.json.",
    generatedAt: new Date().toISOString(),
    termStart: termStart.slice(0, 10),
    termEnd: termEnd.slice(0, 10),
    courses,
    items: [...stable, ...dynamic, ...gradebookOnly],
    sources,
    gaps: (current.gaps ?? [])
      .filter((gap) => !current.courses?.some((course) => !activeCodes.has(course.code) && gap.startsWith(course.code)))
      .map((gap) => gap.replace(/as of \d{4}-\d{2}-\d{2}/, `as of ${new Date().toISOString().slice(0, 10)}`)),
  };
  writeJson(DATA, next);

  return {
    generatedAt: next.generatedAt,
    courses: courses.length,
    liveItems: dynamic.length,
    gradebookOnlyItems: gradebookOnly.length,
    preservedItems: stable.length,
  };
}
