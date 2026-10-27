"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Course } from "@/lib/coursework";
import type { CourseworkPrepData, PrepItem, ReviewStatus } from "@/lib/courseworkPrep";
import design from "./RoomDesign.module.css";

const ICE = "#9ad8ff";
const GOLD = "#ffc861";
const CORAL = "#ff5e5b";
const MINT = "#7ef0b2";

function dueLabel(row: PrepItem) {
  if (!row.item.due) return "NO DATE";
  if (row.item.daysOut == null) return new Date(row.item.due).toLocaleDateString();
  if (row.item.daysOut < 0) return `${Math.abs(row.item.daysOut)}D LATE`;
  if (row.item.daysOut === 0) return "DUE TODAY";
  if (row.item.daysOut === 1) return "DUE TOMORROW";
  return `DUE IN ${row.item.daysOut}D`;
}

function ReviewRow({ row, reload }: { row: PrepItem; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(row.review.note);
  const [copied, setCopied] = useState(false);
  const artifact = row.artifact;
  const urgent = row.item.daysOut != null && row.item.daysOut <= 1 && row.item.status !== "done";

  async function review(status: ReviewStatus) {
    await fetch("/api/coursework/prep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", id: row.item.id, status, note }) });
    await reload();
  }

  async function copy() {
    if (!artifact?.proposedResponse) return;
    await navigator.clipboard.writeText(artifact.proposedResponse);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const statusColor = row.review.status === "reviewed" ? MINT : row.manifest.status === "blocked" ? CORAL : ["ready", "stale"].includes(row.manifest.status) ? GOLD : ICE;
  return (
    <div className="border-t border-hairline first:border-t-0" style={urgent ? { boxShadow: `inset 3px 0 0 ${CORAL}` } : undefined}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ice/50">
        <span className="rounded-full border px-2 py-0.5 font-mono text-[9px] tracking-widest" style={{ color: row.course?.color ?? ICE, borderColor: `${row.course?.color ?? ICE}44`, background: `${row.course?.color ?? ICE}0d` }}>{row.item.type.toUpperCase()}</span>
        <span className="min-w-0 flex-1 text-[13px] font-medium text-white">{row.item.title}</span>
        <span className="font-mono text-[9px] tracking-widest" style={{ color: urgent ? CORAL : "#8b8496" }}>{dueLabel(row)}</span>
        <span className="rounded-full px-2 py-1 font-mono text-[8px] tracking-[0.14em]" style={{ color: statusColor, background: `${statusColor}12`, boxShadow: `inset 0 0 0 1px ${statusColor}33` }}>{row.review.status === "reviewed" ? "REVIEWED" : row.manifest.status.replace("-", " ").toUpperCase()}</span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-hairline bg-void/30 p-4 lg:grid-cols-2">
          <section>
            <p className="seclabel mb-2">SOURCE MATERIAL</p>
            <p className="mb-3 text-[11px] leading-relaxed" style={{ color: row.aiProhibited ? CORAL : row.gradedEvidence ? GOLD : "#8b8496" }}>{row.policyReason}</p>
            <div className="max-h-72 overflow-auto rounded-xl border border-hairline bg-void/60 p-3 text-[12px] leading-relaxed text-mist whitespace-pre-wrap">
              {[row.source?.instructions, row.source?.description].filter(Boolean).join("\n\n") || "Brightspace did not expose the assignment prompt. The workflow will not guess; use the source link and bring the prompt to office hours."}
            </div>
            {row.source?.attachments?.length ? <p className="mt-2 font-mono text-[9px] text-fog">ATTACHMENTS · {row.source.attachments.join(" · ")}</p> : null}
            <a href={row.item.url} target="_blank" rel="noreferrer" className="mt-3 inline-block font-mono text-[10px] tracking-wider text-ice hover:text-white">OPEN SOURCE ↗</a>
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between gap-3"><p className="seclabel">PREPARED WORK</p>{artifact && <span className="font-mono text-[9px] text-fog">REV {artifact.revision} · {artifact.confidence.toUpperCase()}</span>}</div>
            <div className="min-h-40 max-h-96 overflow-auto rounded-xl border border-hairline bg-void/60 p-3 text-[12.5px] leading-7 text-mist whitespace-pre-wrap">
              {artifact?.proposedResponse || row.manifest.blocker?.message || "Queued for preparation. The prep agent will create source-grounded review material here; it will not enter or submit course work."}
            </div>
            {artifact?.uncertainties?.length ? <div className="mt-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed" style={{ color: GOLD, borderColor: `${GOLD}33`, background: `${GOLD}08` }}>CHECK BEFORE TRUSTING · {artifact.uncertainties.join(" · ")}</div> : null}
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="What should the prep agent revise or what do you want to cross-check?" className="mt-3 w-full resize-none rounded-lg border border-hairline bg-void/60 p-2.5 text-[12px] text-mist placeholder:text-fog/50 focus:border-ice/50 focus:outline-none" />
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => review("reviewed")} disabled={!artifact} className="rounded-full border px-3 py-1.5 font-mono text-[9px] tracking-widest disabled:opacity-35" style={{ color: "#050308", background: MINT, borderColor: MINT }}>MARK REVIEWED</button>
              <button onClick={() => review("needs-revision")} className="rounded-full border px-3 py-1.5 font-mono text-[9px] tracking-widest" style={{ color: GOLD, borderColor: `${GOLD}66` }}>NEEDS REVISION</button>
              <button onClick={copy} disabled={!artifact} className="rounded-full border border-hairline px-3 py-1.5 font-mono text-[9px] tracking-widest text-ice disabled:opacity-35">{copied ? "COPIED" : "COPY"}</button>
            </div>
            {artifact && <p className="mt-3 text-[10px] leading-relaxed text-fog">{artifact.notice}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

export default function CourseworkReview({ courses, onReadyCount }: { courses: Course[]; onReadyCount?: (count: number) => void }) {
  const [data, setData] = useState<CourseworkPrepData | null>(null);
  const [filter, setFilter] = useState<"attention" | "all" | "reviewed">("attention");
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => { const response = await fetch("/api/coursework/prep", { cache: "no-store" }); const next = await response.json() as CourseworkPrepData; setData(next); onReadyCount?.(next.counts.ready + next.counts.needsRevision); }, [onReadyCount]);
  useEffect(() => { void load(); }, [load]);

  async function run() {
    setStarting(true); setMessage(null);
    const response = await fetch("/api/coursework/prep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) });
    const result = await response.json() as { started?: boolean; blockedBy?: string };
    setMessage(result.started ? "Preparation started. Results will appear here as each item finishes." : `Could not start: ${result.blockedBy ?? "workflow unavailable"}.`);
    setStarting(false); window.setTimeout(() => void load(), 2500);
  }

  const visible = useMemo(() => (data?.items ?? []).filter((row) => {
    if (courseFilter && row.item.course !== courseFilter) return false;
    if (["done", "skipped", "expired"].includes(row.item.status) && !row.artifact && row.review.status !== "reviewed") return false;
    if (filter === "reviewed") return row.review.status === "reviewed";
    if (filter === "all") return true;
    return row.review.status === "needs-revision" || ["ready", "stale", "blocked"].includes(row.manifest.status) || (row.item.daysOut != null && row.item.daysOut <= 14 && row.item.status !== "done");
  }), [data, filter, courseFilter]);

  if (!data) return <div className="card h-40 animate-pulse opacity-40" />;
  return (
    <div className="space-y-5">
      <div className={design.reviewHero}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="seclabel" style={{ color: ICE }}>COURSE WORKBENCH</p><h3 className="mt-2 text-xl font-medium text-white">Prepared work stays here until you review it.</h3><p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-fog">Source on the left, preparation on the right. Graded, timed, one-attempt, or AI-restricted work is study support only.</p></div>
          <button onClick={run} disabled={starting} className="rounded-full border px-4 py-2 font-mono text-[10px] tracking-widest disabled:opacity-50" style={{ color: ICE, borderColor: `${ICE}66`, background: `${ICE}0d` }}>{starting ? "STARTING…" : "PREPARE NEXT"}</button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">{[["NEEDS REVIEW",data.counts.ready,GOLD],["IN PIPELINE",data.counts.working,ICE],["BLOCKED",data.counts.blocked,CORAL],["REVISIONS",data.counts.needsRevision,GOLD],["REVIEWED",data.counts.reviewed,MINT]].map(([label,value,color])=><div key={String(label)} className="rounded-xl border border-hairline bg-void/40 p-3"><p className="font-mono text-xl" style={{color:String(color)}}>{value}</p><p className="seclabel mt-1">{label}</p></div>)}</div>
        {message && <p className="mt-3 font-mono text-[10px] tracking-wide text-fog">{message}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2"><button onClick={()=>setCourseFilter(null)} className="rounded-full border px-3 py-1 font-mono text-[9px]" style={{color:courseFilter?"#8b8496":ICE,borderColor:courseFilter?"rgba(255,255,255,.1)":`${ICE}66`}}>ALL COURSES</button>{courses.map(course=><button key={course.short} onClick={()=>setCourseFilter(course.short)} className="rounded-full border px-3 py-1 font-mono text-[9px]" style={{color:course.color,borderColor:`${course.color}${courseFilter===course.short?"88":"33"}`,background:courseFilter===course.short?`${course.color}12`:undefined}}>{course.short}</button>)}</div>
        <div className="flex rounded-full border border-hairline p-1">{(["attention","all","reviewed"] as const).map(value=><button key={value} onClick={()=>setFilter(value)} className="rounded-full px-3 py-1 font-mono text-[9px] tracking-widest" style={filter===value?{color:"white",background:"rgba(255,255,255,.07)"}:{color:"#8b8496"}}>{value.toUpperCase()}</button>)}</div>
      </div>
      {visible.length===0 ? <div className="card p-8 text-center text-[12px] text-fog">No coursework matches this review filter.</div> : courses.map(course=>{const rows=visible.filter(row=>row.item.course===course.short); if(!rows.length)return null; return <section key={course.short} className="card overflow-hidden"><div className="h-0.5" style={{background:course.color}}/><div className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="font-mono text-[10px] tracking-widest" style={{color:course.color}}>{course.code}</p><p className="mt-1 text-[13px] text-mist">{course.title}</p></div><span className="font-mono text-[9px] text-fog">{rows.length} ITEM{rows.length===1?"":"S"}</span></div>{rows.map(row=><ReviewRow key={row.item.id} row={row} reload={load}/>)}</section>;})}
    </div>
  );
}
