"use client";

import design from "./RoomDesign.module.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import CourseworkReview from "@/components/CourseworkReview";
import {
  BUCKET_COLOR,
  BUCKET_LABEL,
  TYPE_LABEL,
  courseStats,
  type Bucket,
  type Course,
  type Crunch,
  type DueSource,
  type Item,
  type ItemStatus,
} from "@/lib/coursework";

/**
 * COURSEWORK — the semester as a live priority queue.
 *
 * Self-contained room module: fetches /api/coursework itself (never imports
 * data/coursework.json — a re-scrape has to show up without a rebuild), and
 * writes back through POST for status/note/effort. Three sub-views persisted
 * in localStorage: NOW (priority board), CALENDAR (month + semester shape),
 * COURSES (per-course boards + coverage gaps).
 */

const COLOR = "#9ad8ff";
const GOLD = "#ffc861";
const CORAL = "#ff5e5b";
const VIOLET = "#c4b5fd";
const MINT = "#7ef0b2";

type ApiData = {
  found: boolean;
  generatedAt: string | null;
  term: string;
  termStart: string | null;
  termEnd: string | null;
  courses: Course[];
  items: Item[];
  crunch: Crunch[];
  gaps: string[];
};

type Patch = { status?: ItemStatus; note?: string; effortMin?: number };

const VIEW_KEY = "coursework.view";
type View = "now" | "calendar" | "courses" | "review";

const DUE_SOURCE_LABEL: Record<DueSource, string> = {
  "d2l-duedate": "D2L due date",
  "d2l-availability-end": "D2L availability window end",
  "d2l-topic-end": "D2L topic/module end date",
  syllabus: "Syllabus — not confirmed in D2L",
  inferred: "Inferred — verify before trusting it",
};

const BUCKET_ORDER: Bucket[] = ["overdue", "today", "tomorrow", "week", "fortnight", "later", "undated"];

function fmtEffort(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

function relativeDue(item: Item): string {
  if (item.due === null) return "NO DATE";
  const d = item.daysOut ?? 0;
  if (d < 0) return `${Math.abs(d)} DAY${Math.abs(d) === 1 ? "" : "S"} LATE`;
  if (d === 0) return "TONIGHT";
  if (d === 1) return "TOMORROW";
  if (d <= 7) return `IN ${d} DAYS`;
  return new Date(item.due).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function scrapedStamp(generatedAt: string | null): { text: string; stale: boolean } | null {
  if (!generatedAt) return null;
  const days = Math.floor((Date.now() - new Date(generatedAt).getTime()) / 86_400_000);
  const stale = days > 7;
  return { text: `SCRAPED ${days <= 0 ? "TODAY" : `${days}D AGO`}`, stale };
}

/* ==================================================================== */
/* Shared row + detail                                                   */
/* ==================================================================== */

function ToggleBtn({
  active,
  label,
  color,
  onClick,
}: {
  active: boolean;
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="min-h-8 rounded-full border px-3 py-1 font-mono text-[9px] tracking-widest transition-colors"
      style={
        active
          ? { color: "#050308", background: color, borderColor: color }
          : { color: "#8b8496", borderColor: "rgba(255,255,255,0.1)" }
      }
    >
      {label}
    </button>
  );
}

function ItemDetail({ item, onUpdate }: { item: Item; onUpdate: (id: string, patch: Patch) => void }) {
  const [note, setNote] = useState(item.state.note ?? "");
  const [effort, setEffort] = useState(String(item.effortMin));

  useEffect(() => {
    setNote(item.state.note ?? "");
    setEffort(String(item.effortMin));
  }, [item.id, item.state.note, item.effortMin]);

  return (
    <div className="mt-3 space-y-3 border-t border-hairline pt-3">
      {item.note && <p className="text-[12px] leading-relaxed text-fog">{item.note}</p>}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[9.5px] tracking-wider text-fog">
        <span>SOURCE · {DUE_SOURCE_LABEL[item.dueSource ?? "inferred"]}</span>
        {item.opens && <span>OPENS · {new Date(item.opens).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
        {item.confidence !== "high" && <span style={{ color: GOLD }}>CONFIDENCE · {item.confidence.toUpperCase()}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] tracking-wide text-ice transition-colors hover:text-white"
          >
            OPEN IN D2L ↗
          </a>
        )}
        <label className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-fog">
          EFFORT
          <input
            type="number"
            min={5}
            step={5}
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
            onBlur={() => {
              const n = Number(effort);
              if (Number.isFinite(n) && n > 0) onUpdate(item.id, { effortMin: n });
            }}
            className="w-16 rounded-md border border-hairline bg-void/60 px-2 py-1 text-[11px] text-white focus:border-ice/40 focus:outline-none"
          />
          min
        </label>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note !== (item.state.note ?? "")) onUpdate(item.id, { note });
        }}
        placeholder="Your own note on this one…"
        rows={2}
        className="w-full resize-none rounded-lg border border-hairline bg-void/60 p-2.5 text-[12px] leading-relaxed text-mist placeholder:text-fog/50 focus:border-ice/40 focus:outline-none"
      />
    </div>
  );
}

function ItemRow({
  item,
  course,
  onUpdate,
}: {
  item: Item;
  course: Course | undefined;
  onUpdate: (id: string, patch: Patch) => void;
}) {
  const [open, setOpen] = useState(false);
  const c = course?.color ?? "#8b8496";
  const done = item.status === "done";
  const doing = item.status === "doing";
  const low = item.confidence !== "high";

  return (
    <div
      className="rounded-xl border p-3.5 transition-colors"
      style={
        item.atRisk
          ? { borderColor: "rgba(255,94,91,0.28)", background: "rgba(255,94,91,0.05)" }
          : { borderColor: "rgba(255,255,255,0.06)", background: "rgba(5,3,8,0.4)" }
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-2 text-left sm:basis-auto sm:flex-1">
          <span
            className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] tracking-widest"
            style={{ color: c, background: `${c}14`, boxShadow: `inset 0 0 0 1px ${c}33` }}
          >
            {course?.short ?? item.course}
          </span>
          <span className={`order-last min-w-0 basis-full text-[13px] font-medium leading-relaxed sm:order-none sm:basis-auto sm:flex-1 ${done ? "text-fog line-through" : "text-white"}`}>
            {item.title}
            {low && (
              <span className="ml-1 not-italic" style={{ color: `${GOLD}b3` }} title={`Date confidence: ${item.confidence}. ${DUE_SOURCE_LABEL[item.dueSource ?? "inferred"]}.`}>
                ~
              </span>
            )}
          </span>
          <span className="hidden shrink-0 font-mono text-[9px] tracking-widest text-fog sm:inline">{TYPE_LABEL[item.type]}</span>
          {(item.weightPct != null || item.points != null) && (
            <span className="shrink-0 font-mono text-[10px] text-mist">
              {item.weightPct != null ? `${item.weightPct}%` : `${item.points}pt`}
            </span>
          )}
          <span className="shrink-0 font-mono text-[10px] tracking-wide" style={{ color: BUCKET_COLOR[item.bucket] }}>
            {relativeDue(item)}
          </span>
          <span className="hidden shrink-0 font-mono text-[10px] text-fog/70 sm:inline">~{fmtEffort(item.effortMin)}</span>
        </button>
        <span className="ml-auto flex shrink-0 gap-1.5">
          <ToggleBtn active={doing} label="DOING" color={COLOR} onClick={() => onUpdate(item.id, { status: doing ? "todo" : "doing" })} />
          <ToggleBtn active={done} label="DONE" color={MINT} onClick={() => onUpdate(item.id, { status: done ? "todo" : "done" })} />
        </span>
      </div>
      {open && <ItemDetail item={item} onUpdate={onUpdate} />}
    </div>
  );
}

/* ==================================================================== */
/* NOW                                                                    */
/* ==================================================================== */

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="card p-4">
      <p className="tabular font-mono text-2xl" style={{ color }}>
        {value}
      </p>
      <p className="seclabel mt-1">{label}</p>
    </div>
  );
}

function fmtWeek(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CrunchRow({ week }: { week: Crunch }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3" style={{ borderColor: "rgba(255,94,91,0.28)", background: "rgba(255,94,91,0.06)" }}>
      <span className="font-mono text-[10px] tracking-widest" style={{ color: CORAL }}>
        ▲ {fmtWeek(week.start)}–{fmtWeek(week.end)}
      </span>
      <span className="font-mono text-[11px] text-mist">
        {week.count} ITEM{week.count === 1 ? "" : "S"}
      </span>
      {week.exams > 0 && (
        <span className="font-mono text-[11px]" style={{ color: GOLD }}>
          {week.exams} EXAM{week.exams > 1 ? "S" : ""}
        </span>
      )}
      <span className="font-mono text-[11px] text-fog">~{fmtEffort(week.effortMin)} EST.</span>
    </div>
  );
}

function NowView({
  data,
  courseMap,
  onUpdate,
}: {
  data: ApiData;
  courseMap: Map<string, Course>;
  onUpdate: (id: string, patch: Patch) => void;
}) {
  const [showLater, setShowLater] = useState(false);

  const open = data.items.filter((i) => i.status !== "done" && i.status !== "skipped" && i.status !== "expired");
  // Real hours, not day buckets. `due` carries a full timestamp, and a phone notifier that
  // uses the same 48h window will agree with this tile instead of contradicting it.
  const now = Date.now();
  const due48 = open.filter((i) => {
    if (!i.due) return false;
    const hrs = (new Date(i.due).getTime() - now) / 3_600_000;
    return hrs >= 0 && hrs <= 48;
  }).length;
  const overdue = open.filter((i) => i.bucket === "overdue").length;
  const todayMinutes = open.filter((i) => i.bucket === "today").reduce((a, i) => a + i.effortMin, 0);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="DUE IN 48H" value={due48} color={GOLD} />
        <StatCard label="OVERDUE" value={overdue} color={CORAL} />
        <StatCard label="OPEN ITEMS" value={open.length} color={COLOR} />
        <StatCard label="TODAY'S LOAD" value={todayMinutes > 0 ? fmtEffort(todayMinutes) : "—"} color={VIOLET} />
      </div>

      {data.crunch.length > 0 && (
        <div className="mt-5 space-y-2">
          <p className="seclabel" style={{ color: CORAL }}>
            CRUNCH AHEAD
          </p>
          {data.crunch.map((w) => (
            <CrunchRow key={w.start} week={w} />
          ))}
        </div>
      )}

      <div className="mt-6 space-y-6">
        {open.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-[13px] text-fog">Nothing open. Everything scraped is done, skipped, or expired.</p>
          </div>
        ) : (
          BUCKET_ORDER.map((b) => {
            const list = open.filter((i) => i.bucket === b);
            if (list.length === 0) return null;

            if (b === "later" && !showLater) {
              return (
                <button
                  key={b}
                  onClick={() => setShowLater(true)}
                  className="w-full rounded-lg border border-hairline px-4 py-2.5 text-left font-mono text-[10px] tracking-widest text-fog transition-colors hover:border-white/20 hover:text-mist"
                >
                  ＋ {list.length} more later
                </button>
              );
            }

            return (
              <div key={b}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: BUCKET_COLOR[b], boxShadow: `0 0 8px ${BUCKET_COLOR[b]}` }} />
                  <p className="seclabel" style={{ color: BUCKET_COLOR[b] }}>
                    {BUCKET_LABEL[b]}
                  </p>
                  <span className="font-mono text-[10px] text-fog">{list.length}</span>
                </div>
                <div className="space-y-2">
                  {list.map((i) => (
                    <ItemRow key={i.id} item={i} course={courseMap.get(i.course)} onUpdate={onUpdate} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ==================================================================== */
/* CALENDAR                                                               */
/* ==================================================================== */

function monthOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function clampMonth(month: Date, start: Date | null, end: Date | null): Date {
  let m = month;
  if (start && m < start) m = start;
  if (end && m > end) m = end;
  return m;
}

function AgendaList({
  items,
  courseMap,
  onUpdate,
}: {
  items: Item[];
  courseMap: Map<string, Course>;
  onUpdate: (id: string, patch: Patch) => void;
}) {
  const dated = useMemo(
    () => items.filter((i) => i.due).sort((a, b) => (a.due as string).localeCompare(b.due as string)),
    [items],
  );
  const undated = items.filter((i) => !i.due);

  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of dated) {
      const key = dayKey(i.due as string);
      const list = map.get(key) ?? [];
      list.push(i);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [dated]);

  if (groups.length === 0 && undated.length === 0) {
    return <p className="p-4 text-[12px] text-fog">Nothing here.</p>;
  }

  return (
    <div className="space-y-5">
      {groups.map(([key, list]) => (
        <div key={key}>
          <p className="seclabel mb-2">
            {new Date(`${key}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </p>
          <div className="space-y-2">
            {list.map((i) => (
              <ItemRow key={i.id} item={i} course={courseMap.get(i.course)} onUpdate={onUpdate} />
            ))}
          </div>
        </div>
      ))}
      {undated.length > 0 && (
        <div>
          <p className="seclabel mb-2 text-fog/60">NO DATE YET</p>
          <div className="space-y-2">
            {undated.map((i) => (
              <ItemRow key={i.id} item={i} course={courseMap.get(i.course)} onUpdate={onUpdate} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SemesterStrip({
  items,
  courseMap,
  bounds,
}: {
  items: Item[];
  courseMap: Map<string, Course>;
  bounds: { start: Date; end: Date } | null;
}) {
  if (!bounds) return null;
  const span = bounds.end.getTime() - bounds.start.getTime();
  if (span <= 0) return null;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - bounds.start.getTime()) / span) * 100));
  const todayPct = pct(Date.now());
  const dated = items.filter((i) => i.due);

  return (
    <div className="mt-6">
      <p className="seclabel mb-2">THE SEMESTER</p>
      <div className="relative h-8 rounded-full border border-hairline bg-void/40">
        {dated.map((i) => (
          <div
            key={i.id}
            className="absolute top-1 h-6 w-px"
            style={{ left: `${pct(new Date(i.due as string).getTime())}%`, background: courseMap.get(i.course)?.color ?? "#8b8496", opacity: 0.75 }}
            title={`${i.title} — ${new Date(i.due as string).toLocaleDateString()}`}
          />
        ))}
        <div
          className="absolute -top-1 h-10 w-0.5 rounded-full"
          style={{ left: `${todayPct}%`, background: VIOLET, boxShadow: `0 0 10px ${VIOLET}` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[9px] tracking-wider text-fog">
        <span>{bounds.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        <span style={{ color: VIOLET }}>YOU ARE HERE</span>
        <span>{bounds.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
      </div>
    </div>
  );
}

function CalendarView({
  data,
  courseMap,
  onUpdate,
}: {
  data: ApiData;
  courseMap: Map<string, Course>;
  onUpdate: (id: string, patch: Patch) => void;
}) {
  const termStartMonth = data.termStart ? monthOf(new Date(data.termStart)) : null;
  const termEndMonth = data.termEnd ? monthOf(new Date(data.termEnd)) : null;

  const [cursor, setCursor] = useState(() => clampMonth(monthOf(new Date()), termStartMonth, termEndMonth));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [sub, setSub] = useState<"grid" | "list">("grid");

  const filtered = useMemo(
    () => (courseFilter ? data.items.filter((i) => i.course === courseFilter) : data.items),
    [data.items, courseFilter],
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const i of filtered) {
      if (!i.due) continue;
      const key = dayKey(i.due);
      const list = map.get(key) ?? [];
      list.push(i);
      map.set(key, list);
    }
    return map;
  }, [filtered]);

  const gridDays = useMemo(() => {
    const startWeekday = cursor.getDay();
    const gridStart = new Date(cursor);
    gridStart.setDate(cursor.getDate() - startWeekday);
    return Array.from({ length: 42 }, (_, i) => {
      const dt = new Date(gridStart);
      dt.setDate(gridStart.getDate() + i);
      return dt;
    });
  }, [cursor]);

  const todayKey = dayKey(new Date().toISOString());
  const canPrev = !termStartMonth || cursor.getTime() > termStartMonth.getTime();
  const canNext = !termEndMonth || cursor.getTime() < termEndMonth.getTime();

  const monthItems = filtered.filter((i) => {
    if (!i.due) return false;
    const d = new Date(i.due);
    return d.getFullYear() === cursor.getFullYear() && d.getMonth() === cursor.getMonth();
  });

  const dayItems = selectedDay ? itemsByDay.get(selectedDay) ?? [] : [];

  const bounds = useMemo(() => {
    if (data.termStart && data.termEnd) return { start: new Date(data.termStart), end: new Date(data.termEnd) };
    const dated = data.items.filter((i) => i.due).map((i) => new Date(i.due as string).getTime());
    if (dated.length === 0) return null;
    return { start: new Date(Math.min(...dated)), end: new Date(Math.max(...dated)) };
  }, [data]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          <button
            onClick={() => canPrev && setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            disabled={!canPrev}
            className="rounded-lg border border-hairline px-2.5 py-1.5 font-mono text-[11px] text-fog transition-colors hover:text-white disabled:opacity-30"
          >
            ←
          </button>
          <p className="min-w-0 flex-1 text-center font-mono text-[12px] tracking-wide text-white sm:w-36 sm:flex-none sm:text-[13px]">
            {cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
          <button
            onClick={() => canNext && setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            disabled={!canNext}
            className="rounded-lg border border-hairline px-2.5 py-1.5 font-mono text-[11px] text-fog transition-colors hover:text-white disabled:opacity-30"
          >
            →
          </button>
          <button
            onClick={() => setCursor(clampMonth(monthOf(new Date()), termStartMonth, termEndMonth))}
            className="rounded-lg border px-2.5 py-1.5 font-mono text-[10px] tracking-widest transition-colors"
            style={{ borderColor: `${COLOR}4d`, color: COLOR }}
          >
            TODAY
          </button>
        </div>
        <div className="flex gap-1 rounded-xl border border-hairline bg-void/40 p-1">
          {(["grid", "list"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSub(k)}
              className={`rounded-lg px-3 py-1.5 font-mono text-[10px] tracking-widest transition-colors ${sub === k ? "text-white" : "text-fog hover:text-mist"}`}
              style={sub === k ? { background: `${COLOR}14`, boxShadow: `inset 0 0 0 1px ${COLOR}4d` } : undefined}
            >
              {k.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {data.courses.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data.courses.map((c) => {
            const active = courseFilter === c.short;
            return (
              <button
                key={c.short}
                onClick={() => setCourseFilter(active ? null : c.short)}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] tracking-widest transition-colors"
                style={{
                  color: active ? c.color : "#8b8496",
                  borderColor: active ? `${c.color}66` : "rgba(255,255,255,0.08)",
                  background: active ? `${c.color}14` : "transparent",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                {c.short}
              </button>
            );
          })}
        </div>
      )}

      {sub === "grid" ? (
        <>
          <div className="hidden sm:block">
            <div className="mb-1.5 grid grid-cols-7 gap-1.5">
              {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                <p key={d} className="text-center font-mono text-[9px] tracking-widest text-fog/60">
                  {d}
                </p>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {gridDays.map((d, idx) => {
                const key = dayKey(d.toISOString());
                const inMonth = d.getMonth() === cursor.getMonth();
                const isToday = key === todayKey;
                const items = itemsByDay.get(key) ?? [];
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDay(key)}
                    className="min-h-[84px] rounded-lg border p-1.5 text-left transition-colors hover:border-white/20"
                    style={{
                      borderColor: isToday ? VIOLET : "rgba(255,255,255,0.06)",
                      background: "rgba(5,3,8,0.35)",
                      opacity: inMonth ? 1 : 0.35,
                      boxShadow: isToday ? `inset 0 0 0 1px ${VIOLET}` : undefined,
                    }}
                  >
                    <p className="font-mono text-[10px]" style={{ color: isToday ? VIOLET : "#8b8496" }}>
                      {d.getDate()}
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {items.slice(0, 3).map((i) => (
                        <div key={i.id} className="flex items-center gap-1">
                          <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: courseMap.get(i.course)?.color ?? "#8b8496" }} />
                          <span className="truncate text-[9px] text-mist">{i.title}</span>
                        </div>
                      ))}
                      {items.length > 3 && <p className="text-[9px] text-fog">+{items.length - 3}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sm:hidden">
            <AgendaList items={monthItems} courseMap={courseMap} onUpdate={onUpdate} />
          </div>
        </>
      ) : (
        <AgendaList items={filtered} courseMap={courseMap} onUpdate={onUpdate} />
      )}

      {selectedDay && (
        <section className="card mt-4 p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="seclabel">
              {new Date(`${selectedDay}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <button onClick={() => setSelectedDay(null)} className="font-mono text-[10px] tracking-widest text-fog hover:text-white">
              CLOSE
            </button>
          </div>
          {dayItems.length === 0 ? (
            <p className="text-[12px] text-fog">Nothing due this day.</p>
          ) : (
            <div className="space-y-2">
              {dayItems.map((i) => (
                <ItemRow key={i.id} item={i} course={courseMap.get(i.course)} onUpdate={onUpdate} />
              ))}
            </div>
          )}
        </section>
      )}

      <SemesterStrip items={filtered} courseMap={courseMap} bounds={bounds} />
    </div>
  );
}

/* ==================================================================== */
/* COURSES                                                                */
/* ==================================================================== */

function CoursesView({ data }: { data: ApiData }) {
  return (
    <div className="space-y-5">
      {data.courses.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-[13px] text-fog">No courses scraped yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.courses.map((c) => {
            const items = data.items.filter((i) => i.course === c.short);
            const stats = courseStats(items);
            const overdue = items.filter((i) => i.bucket === "overdue" && i.status !== "done").length;
            return (
              <div key={c.short} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] tracking-widest" style={{ color: c.color }}>
                      {c.code}
                    </p>
                    <p className="mt-0.5 truncate text-[15px] font-medium text-white">{c.title}</p>
                    <p className="mt-1 text-[11.5px] text-fog">
                      {c.meets}
                      {c.instructor ? ` · ${c.instructor}` : ""}
                    </p>
                  </div>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 font-mono text-[10px] tracking-widest text-fog transition-colors hover:text-ice"
                  >
                    OPEN COURSE ↗
                  </a>
                </div>

                {items.length === 0 ? (
                  <p className="mt-4 text-[12px] text-fog">No items scraped for this course yet.</p>
                ) : (
                  <>
                    <div className="mt-4">
                      <div className="flex items-baseline justify-between">
                        <p className="seclabel">
                          {stats.done}/{stats.total} DONE
                        </p>
                        {overdue > 0 && (
                          <span className="font-mono text-[10px]" style={{ color: CORAL }}>
                            {overdue} OVERDUE
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${stats.pct}%`, background: c.color, boxShadow: `0 0 10px ${c.color}66` }}
                        />
                      </div>
                    </div>
                    {stats.next && (
                      <p className="mt-3 text-[12px] text-mist">
                        NEXT · <span className="text-white">{stats.next.title}</span>{" "}
                        <span className="text-fog">
                          {new Date(stats.next.due as string).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      </p>
                    )}
                    {c.gradeWeights.length > 0 && (
                      <div className="mt-4 border-t border-hairline pt-3">
                        <p className="seclabel mb-2">GRADE WEIGHTS</p>
                        <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-white/5">
                          {c.gradeWeights
                            .filter((w) => w.weightPct != null)
                            .map((w, i) => (
                              <div
                                key={w.name}
                                style={{ width: `${w.weightPct}%`, background: `${c.color}${i % 2 === 0 ? "" : "99"}` }}
                                title={`${w.name} · ${w.weightPct}%`}
                              />
                            ))}
                        </div>
                        <div className="space-y-1">
                          {c.gradeWeights.map((w) => (
                            <div key={w.name} className="flex items-center justify-between text-[11.5px]">
                              <span className="text-mist">{w.name}</span>
                              <span className="font-mono text-fog">
                                {w.weightPct != null ? `${w.weightPct}%` : w.max != null ? `${w.max}pt` : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {c.syllabusNote && (
                  <p className="mt-4 border-t border-hairline pt-3 text-[10.5px] leading-relaxed text-fog/70">{c.syllabusNote}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="card p-5">
        <p className="seclabel mb-3" style={{ color: data.gaps.length > 0 ? GOLD : MINT }}>
          NOT COVERED
        </p>
        {data.gaps.length === 0 ? (
          <p className="text-[12px] text-fog">Nothing flagged as missing by the scrape.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.gaps.map((g, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed" style={{ color: `${GOLD}e6` }}>
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: GOLD }} />
                {g}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ==================================================================== */
/* Room                                                                   */
/* ==================================================================== */

function LoadingSkeleton() {
  return (
    <div className="mt-8 space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card h-24 animate-pulse opacity-40" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <section className="fade-up card mt-8 p-8 text-center">
      <p className="seclabel mb-2">COURSEWORK NOT SCRAPED YET</p>
      <p className="mx-auto max-w-md text-[13px] leading-relaxed text-fog">
        No scrape has run against D2L yet. This view reads <span className="font-mono">data/coursework.json</span>{" "}
        live and renders nothing until that file exists with real items, on purpose. Run{" "}
        <span className="font-mono">npm run seed</span> to load the sample course.
      </p>
    </section>
  );
}

export default function Coursework() {
  const [data, setData] = useState<ApiData | null>(null);
  const [view, setView] = useState<View>("now");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "now" || saved === "calendar" || saved === "courses" || saved === "review") setView(saved);
    } catch {
      /* private mode — the view just won't persist */
    }
  }, []);

  function pickView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* same */
    }
  }

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/coursework", { cache: "no-store" });
      const j = (await r.json()) as ApiData;
      setData(j);
    } catch {
      setData({ found: false, generatedAt: null, term: "", termStart: null, termEnd: null, courses: [], items: [], crunch: [], gaps: [] });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onUpdate = useCallback(
    (id: string, patch: Patch) => {
      // Optimistic: reflect the change instantly, then reconcile with the real
      // (re-ranked) items from the server — status flips move an item's bucket
      // and score, which only the server-side hydrate() can recompute correctly.
      setData((d) => {
        if (!d) return d;
        return {
          ...d,
          items: d.items.map((i) =>
            i.id === id
              ? {
                  ...i,
                  ...(patch.status !== undefined ? { status: patch.status } : {}),
                  ...(patch.effortMin !== undefined ? { effortMin: patch.effortMin } : {}),
                  state: {
                    ...i.state,
                    ...(patch.status !== undefined ? { status: patch.status } : {}),
                    ...(patch.note !== undefined ? { note: patch.note } : {}),
                    ...(patch.effortMin !== undefined ? { effortMin: patch.effortMin } : {}),
                  },
                }
              : i,
          ),
        };
      });
      (async () => {
        try {
          await fetch("/api/coursework", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, ...patch }),
          });
        } catch {
          /* the refetch below reconciles either way */
        }
        await load();
      })();
    },
    [load],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch("/api/coursework/refresh", { method: "POST" });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to refresh Brightspace coursework.");
      await load();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Unable to refresh Brightspace coursework.");
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const courseMap = useMemo(() => new Map((data?.courses ?? []).map((c) => [c.short, c] as const)), [data]);

  if (!data) return <LoadingSkeleton />;
  if (!data.found) return <EmptyState />;

  const stamp = scrapedStamp(data.generatedAt);

  return (
    <div className="mt-8">
      <div className={design.subhead}>
        <div><p className={design.eyebrow}>Brightspace / your study desk</p><h2 className={design.sectionTitle}>{view === "now" ? "The next things first." : view === "calendar" ? "See the semester ahead." : view === "courses" ? "Every course, in context." : "Source. Prepare. Review."}</h2></div>
        <p className="max-w-xs text-xs leading-relaxed text-fog">{view === "review" ? "Preparation stays separate from submission. You stay in control." : "Dates, confidence, and your own progress marks stay visible."}</p>
      </div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className={design.tabs} aria-label="Coursework view">
          {(
            [
              { key: "now" as View, label: "NOW" },
              { key: "calendar" as View, label: "CALENDAR" },
              { key: "courses" as View, label: "COURSES" },
              { key: "review" as View, label: "REVIEW" },
            ]
          ).map((t) => {
            const on = view === t.key;
            return (
              <button
                key={t.key}
                onClick={() => pickView(t.key)}
                aria-pressed={on}
              >
                {t.label}{t.key === "review" && reviewCount > 0 ? ` · ${reviewCount}` : ""}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 font-mono text-[10px] tracking-widest text-fog">
          <span>{data.term}</span>
          {stamp && (
            <span style={stamp.stale ? { color: GOLD } : undefined}>
              {stamp.text}
              {stamp.stale ? " · MAY BE STALE" : ""}
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="rounded-full border px-3 py-1.5 text-[9px] tracking-[0.14em] transition-colors disabled:cursor-wait disabled:opacity-60"
            style={{ color: COLOR, borderColor: `${COLOR}66`, background: `${COLOR}0d` }}
            title="Refresh all coursework from your signed-in Brightspace tab"
          >
            {refreshing ? "REFRESHING D2L…" : "REFRESH FROM D2L"}
          </button>
        </div>
      </div>
      {refreshError && (
        <p className="-mt-2 mb-5 font-mono text-[10px] leading-relaxed tracking-wide" style={{ color: CORAL }}>
          REFRESH FAILED · {refreshError}
        </p>
      )}

      {view === "now" && <NowView data={data} courseMap={courseMap} onUpdate={onUpdate} />}
      {view === "calendar" && <CalendarView data={data} courseMap={courseMap} onUpdate={onUpdate} />}
      {view === "courses" && <CoursesView data={data} />}
      {view === "review" && <CourseworkReview courses={data.courses} onReadyCount={setReviewCount} />}
    </div>
  );
}
