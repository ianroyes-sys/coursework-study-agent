/**
 * Coursework — the semester as a queue.
 *
 * Everything here is pure and runs on both sides: the API route uses it to build
 * the payload, the room uses it to re-rank live as the clock moves. The scraped
 * file (`data/coursework.json`) is never mutated — your own marks live in
 * `data/coursework-state.json` and are merged at read time (aggregate on read).
 */

export type DueSource =
  | "d2l-duedate"
  | "d2l-availability-end"
  | "d2l-topic-end"
  | "syllabus"
  | "inferred";

export type ItemType = "assignment" | "quiz" | "discussion" | "exam" | "reading" | "project" | "other";

export type Confidence = "high" | "medium" | "low";

/** "expired": the due date passed unfinished; set by scripts/expiry.mjs, reversible, never "done". */
export type ItemStatus = "todo" | "doing" | "done" | "skipped" | "expired";

export type Course = {
  short: string;
  code: string;
  title: string;
  d2lId: number;
  meets: string;
  color: string;
  instructor: string | null;
  url: string;
  gradeWeights: { name: string; weightPct: number | null; max: number | null }[];
  syllabusNote: string;
};

export type RawItem = {
  id: string;
  course: string;
  type: ItemType;
  title: string;
  due: string | null;
  dueSource: DueSource | null;
  opens: string | null;
  points: number | null;
  weightPct: number | null;
  url: string;
  confidence: Confidence;
  note: string;
};

export type ItemState = {
  status?: ItemStatus;
  doneAt?: string;
  note?: string;
  /** Your own estimate, minutes. Falls back to a per-type default. */
  effortMin?: number;
};

export type Item = RawItem & {
  state: ItemState;
  status: ItemStatus;
  /** Whole days until due. Negative = overdue. `null` when the item has no date. */
  daysOut: number | null;
  bucket: Bucket;
  score: number;
  effortMin: number;
  /** Set when the thing is worth a lot and there is no longer much runway. */
  atRisk: boolean;
};

export type Bucket = "overdue" | "today" | "tomorrow" | "week" | "fortnight" | "later" | "undated";

export const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: "OVERDUE",
  today: "TODAY",
  tomorrow: "TOMORROW",
  week: "THIS WEEK",
  fortnight: "NEXT TWO WEEKS",
  later: "LATER",
  undated: "NO DATE YET",
};

export const BUCKET_COLOR: Record<Bucket, string> = {
  overdue: "#ff5e5b",
  today: "#ff8a3d",
  tomorrow: "#ffc861",
  week: "#9ad8ff",
  fortnight: "#c4b5fd",
  later: "#8b8496",
  undated: "#8b8496",
};

export const TYPE_LABEL: Record<ItemType, string> = {
  assignment: "ASSIGNMENT",
  quiz: "QUIZ",
  discussion: "DISCUSSION",
  exam: "EXAM",
  reading: "READING",
  project: "PROJECT",
  other: "ITEM",
};

/** Rough minutes, used only until you override one. Exams price the studying, not the sitting. */
const DEFAULT_EFFORT: Record<ItemType, number> = {
  assignment: 60,
  quiz: 25,
  discussion: 30,
  exam: 180,
  reading: 45,
  project: 180,
  other: 45,
};

const DAY = 86_400_000;

/** Midnight-anchored day difference, so "due tonight at 11:59" reads as today, not tomorrow. */
export function daysUntil(iso: string, now: Date): number {
  const due = new Date(iso);
  const a = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / DAY);
}

export function bucketFor(daysOut: number | null): Bucket {
  if (daysOut === null) return "undated";
  if (daysOut < 0) return "overdue";
  if (daysOut === 0) return "today";
  if (daysOut === 1) return "tomorrow";
  if (daysOut <= 7) return "week";
  if (daysOut <= 14) return "fortnight";
  return "later";
}

/**
 * One number that answers "what do I touch next".
 *
 * Urgency dominates — a deadline is the only thing here that cannot be renegotiated —
 * but weight is what stops the ranking from becoming a pure countdown, where a 5-point
 * discussion outranks the exam three days behind it. Undated work still scores, low,
 * because an unknown date is a real risk and hiding it is how a semester goes wrong.
 */
export function scoreItem(item: RawItem, status: ItemStatus, daysOut: number | null, effortMin: number): number {
  if (status === "done" || status === "skipped" || status === "expired") return -1;

  // Urgency: 100 at due-today, decaying with runway, and climbing past 100 once late.
  let urgency: number;
  if (daysOut === null) urgency = 22;
  else if (daysOut < 0) urgency = 130 + Math.min(40, -daysOut * 6);
  else urgency = 100 / (1 + daysOut * 0.55);

  // Weight: points carry it when a percentage isn't published.
  const weight = item.weightPct != null ? item.weightPct * 2.2 : Math.min(40, (item.points ?? 8) * 0.9);

  // An exam is never just its point value.
  const kind = item.type === "exam" ? 26 : item.type === "project" ? 16 : 0;

  // Long work needs to surface before short work of the same value.
  const runway = daysOut != null && daysOut >= 0 ? Math.max(0, (effortMin / 60) * 4 - daysOut * 1.5) : 0;

  // An undated item we cannot even verify is worth a nudge to go read the syllabus.
  const unknown = item.due === null ? 10 : item.confidence === "low" ? 6 : 0;

  const started = status === "doing" ? 8 : 0;

  return Math.round((urgency + weight + kind + runway + unknown + started) * 10) / 10;
}

export function hydrate(
  raw: RawItem[],
  state: Record<string, ItemState>,
  now: Date = new Date(),
): Item[] {
  return raw
    .map((item) => {
      const st = state[item.id] ?? {};
      const status: ItemStatus = st.status ?? "todo";
      const daysOut = item.due ? daysUntil(item.due, now) : null;
      const effortMin = st.effortMin ?? DEFAULT_EFFORT[item.type] ?? 45;
      const score = scoreItem(item, status, daysOut, effortMin);
      const value = item.weightPct != null ? item.weightPct : (item.points ?? 0) / 4;
      return {
        ...item,
        state: st,
        status,
        daysOut,
        bucket: bucketFor(daysOut),
        score,
        effortMin,
        atRisk: status !== "done" && daysOut != null && daysOut >= 0 && daysOut <= 3 && value >= 8,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Weeks where the semester bunches up. You see these *before* the week starts —
 * a collision only helps if it's visible while there's still room to move.
 */
export type Crunch = { start: string; end: string; count: number; exams: number; effortMin: number; items: Item[] };

export function crunchWeeks(items: Item[], now: Date = new Date(), horizonWeeks = 6): Crunch[] {
  const dated = items.filter((i) => i.due && i.status !== "done" && i.status !== "skipped" && i.status !== "expired");
  const byWeek = new Map<string, Item[]>();

  for (const item of dated) {
    const d = new Date(item.due as string);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);
    const list = byWeek.get(key) ?? [];
    list.push(item);
    byWeek.set(key, list);
  }

  const weeks = [...byWeek.entries()]
    .map(([start, list]) => {
      const end = new Date(`${start}T00:00:00`);
      end.setDate(end.getDate() + 6);
      return {
        start,
        end: end.toISOString().slice(0, 10),
        count: list.length,
        exams: list.filter((i) => i.type === "exam").length,
        effortMin: list.reduce((a, i) => a + i.effortMin, 0),
        items: list.sort((a, b) => (a.due as string).localeCompare(b.due as string)),
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  // A crunch is only a crunch relative to a normal week in *this* semester. A fixed
  // threshold flagged all fifteen weeks, which is the same as flagging none — the
  // warning has to be rarer than the thing it warns about.
  const loads = weeks.map((w) => w.effortMin).sort((a, b) => a - b);
  const median = loads.length ? loads[Math.floor(loads.length / 2)] : 0;
  const horizon = new Date(now.getTime() + horizonWeeks * 7 * DAY);

  return weeks.filter((w) => {
    const end = new Date(`${w.end}T23:59:59`);
    if (end < now || new Date(`${w.start}T00:00:00`) > horizon) return false;
    return w.exams > 0 || (w.effortMin >= median * 1.5 && w.count >= 5);
  });
}

/**
 * "If I want a B in this course, what do the remaining pieces have to average?"
 *
 * Only meaningful once something is actually graded, so it returns null rather than
 * a confident-looking number built on an empty gradebook.
 */
export function neededAverage(earnedPct: number, gradedWeight: number, targetPct: number): number | null {
  const remaining = 100 - gradedWeight;
  if (remaining <= 0.5 || gradedWeight <= 0) return null;
  return Math.round(((targetPct - (earnedPct * gradedWeight) / 100) / remaining) * 100 * 10) / 10;
}

export function courseStats(items: Item[]) {
  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const overdue = items.filter((i) => i.bucket === "overdue" && i.status !== "done").length;
  const undated = items.filter((i) => i.due === null).length;
  const next = items
    .filter((i) => i.due && i.status !== "done" && (i.daysOut ?? -1) >= 0)
    .sort((a, b) => (a.due as string).localeCompare(b.due as string))[0];
  return { total, done, overdue, undated, next, pct: total ? Math.round((done / total) * 100) : 0 };
}
