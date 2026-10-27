#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Same data directory the web app uses (lib/server/paths.ts).
const DATA_DIR = path.resolve(ROOT, process.env.COURSEWORK_DATA_DIR || "data");
const DATA = path.join(DATA_DIR, "coursework.json");
const STATE = path.join(DATA_DIR, "coursework-state.json");
const REVIEW = path.join(DATA_DIR, "coursework-review-state.json");
const MANIFEST = path.join(DATA_DIR, "coursework-prep.json");
const ARTIFACT_ROOT = path.join(DATA_DIR, "coursework-prep");
const POLICY = "prep-only-no-submission";
const NOTICE = "Study draft for your review. Nothing was entered or submitted.";

const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const atomic = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(tmp, file); };
const fingerprint = (item, source) => crypto.createHash("sha256").update(JSON.stringify({ id:item.id, course:item.course, type:item.type, title:item.title, due:item.due, points:item.points, weightPct:item.weightPct, url:item.url, note:item.note, source })).digest("hex");
const sourceText = (source) => [source?.instructions, source?.description].filter(Boolean).join("\n\n").trim();
function policyFor(item, source) {
  const material = `${item.title}\n${item.note}\n${sourceText(source)}`;
  const aiProhibited = /(?:do (?:their|your) own work|ai (?:platform|generated|tools?).{0,80}(?:not|prohibit|forbid)|without (?:using )?ai)/i.test(material);
  const graded = Boolean(source?.gradeItemId || source?.autoExportToGrades || (source?.possiblePoints ?? item.points ?? 0) > 0 || item.weightPct);
  const timed = item.type === "quiz" || item.type === "exam" || source?.timeLimitMinutes != null || source?.attemptsAllowed === 1;
  if (aiProhibited) return { kind:"study-guide", aiProhibited, graded, reason:"Course instructions restrict AI-generated work. Study support only." };
  if (timed) return { kind:"quiz-prep", aiProhibited, graded, reason:"Timed or attempt-based assessment. Never start or answer the attempt." };
  if (graded) return { kind:"outline", aiProhibited, graded, reason:"Linked to points or gradebook. Outline/research support only." };
  if (/\b(practice|self[- ]assessment|review|flashcards?)\b/i.test(material)) return { kind:"answer-draft", aiProhibited, graded, reason:"Explicitly labeled practice/review work." };
  return { kind:"study-guide", aiProhibited, graded, reason:"Ungraded status is not proven. Study support only." };
}
function context() {
  const data = read(DATA, { items:[], sources:{} });
  const state = read(STATE, {});
  const review = read(REVIEW, {});
  const manifest = read(MANIFEST, { version:1, updatedAt:new Date().toISOString(), policy:POLICY, items:{} });
  return { data, state, review, manifest };
}
function sync() {
  const { data, state, manifest } = context(); const next = { version:1, updatedAt:new Date().toISOString(), policy:POLICY, items:{} };
  for (const item of data.items || []) {
    const old = manifest.items?.[item.id]; const fp = fingerprint(item, data.sources?.[item.id] ?? null);
    const complete = ["done","skipped","expired"].includes(state[item.id]?.status);
    const sourceChanged = Boolean(old && old.sourceFingerprint !== fp);
    next.items[item.id] = { courseworkId:item.id, course:item.course, sourceFingerprint:fp,
      status: sourceChanged ? (old?.status === "ready" ? "stale" : (complete ? "blocked" : "queued")) : (old?.status ?? (complete ? "blocked" : "queued")),
      currentRevision:old?.currentRevision ?? 0, artifactPath:old?.artifactPath ?? null, generatedAt:old?.generatedAt ?? null,
      blocker:old?.blocker ?? (complete ? {code:"complete",message:"Already marked complete in Coursework."}:null) };
  }
  atomic(MANIFEST,next); return next;
}
function candidates(limit=4) {
  sync(); const { data, state, review, manifest } = context(); const now=Date.now();
  return (data.items||[]).filter(item=>!["done","skipped","expired"].includes(state[item.id]?.status))
    .filter(item=>!["ready","blocked"].includes(manifest.items[item.id]?.status) || review[item.id]?.status === "needs-revision")
    .map(item=>{ const source=data.sources?.[item.id]??null; const p=policyFor(item,source); const due=item.due?new Date(item.due).getTime():Number.MAX_SAFE_INTEGER; return { item, source, sourceMaterial:sourceText(source), policy:p, reviewNote:review[item.id]?.note||"", revisionRequested:review[item.id]?.status==="needs-revision", sourceFingerprint:manifest.items[item.id].sourceFingerprint, priority:due===Number.MAX_SAFE_INTEGER?1:Math.max(2,10000000000000-Math.abs(due-now)) }; })
    .sort((a,b)=>Number(b.revisionRequested)-Number(a.revisionRequested)||(a.item.due||"9999").localeCompare(b.item.due||"9999"))
    .slice(0,limit);
}
function publish(id, payloadFile) {
  if (!/^[a-z0-9-]+$/.test(id)) throw Error("invalid item id");
  sync(); const { data, manifest }=context(); const item=(data.items||[]).find(x=>x.id===id); if(!item) throw Error("unknown item");
  const source=data.sources?.[id]??null; const p=policyFor(item,source); const payload=read(path.resolve(payloadFile),null); if(!payload||typeof payload!=="object") throw Error("invalid payload");
  const allowed=p.kind==="answer-draft"?["answer-draft","study-guide","outline","research-notes"]:[p.kind,"study-guide","outline","research-notes"];
  if(!allowed.includes(payload.kind)) throw Error(`kind ${payload.kind} violates ${p.reason}`);
  const revision=(manifest.items[id]?.currentRevision||0)+1; const artifact={schemaVersion:1,courseworkId:id,revision,kind:payload.kind,createdAt:new Date().toISOString(),
    sourceSnapshot:{title:item.title,course:item.course,type:item.type,due:item.due,url:item.url,prompt:sourceText(source)||null},summary:String(payload.summary||"").slice(0,4000),
    proposedResponse:String(payload.proposedResponse||"").slice(0,30000),reasoning:Array.isArray(payload.reasoning)?payload.reasoning.map(String).slice(0,20):[],selfCheck:Array.isArray(payload.selfCheck)?payload.selfCheck.map(String).slice(0,20):[],
    sources:Array.isArray(payload.sources)?payload.sources.slice(0,20).map(x=>({label:String(x.label||""),url:String(x.url||""),supports:String(x.supports||"")})):[],uncertainties:Array.isArray(payload.uncertainties)?payload.uncertainties.map(String).slice(0,20):[],officeHoursQuestions:Array.isArray(payload.officeHoursQuestions)?payload.officeHoursQuestions.map(String).slice(0,20):[],confidence:["high","medium","low"].includes(payload.confidence)?payload.confidence:"low",notice:NOTICE};
  const rel=path.join("coursework-prep",item.course,id,`v${String(revision).padStart(3,"0")}.json`); atomic(path.join(DATA_DIR,rel),artifact);
  manifest.items[id]={...manifest.items[id],status:"ready",currentRevision:revision,artifactPath:rel,generatedAt:artifact.createdAt,blocker:null}; manifest.updatedAt=new Date().toISOString(); atomic(MANIFEST,manifest); console.log(rel);
}
function block(id, code, message) { sync(); const { manifest }=context(); if(!manifest.items[id]) throw Error("unknown item"); manifest.items[id]={...manifest.items[id],status:"blocked",blocker:{code:String(code).slice(0,80),message:String(message).slice(0,1000)}}; manifest.updatedAt=new Date().toISOString(); atomic(MANIFEST,manifest); }
function verify() { const { data,manifest }=context(); const errors=[]; for(const [id,row] of Object.entries(manifest.items||{})){if(!(data.items||[]).some(x=>x.id===id)) errors.push(`${id}: orphan`); if(row.artifactPath){const p=path.resolve(DATA_DIR,row.artifactPath); if(!p.startsWith(`${ARTIFACT_ROOT}${path.sep}`)||!fs.existsSync(p)) errors.push(`${id}: bad artifact path`);}} console.log(JSON.stringify({ok:!errors.length,items:Object.keys(manifest.items||{}).length,errors},null,2)); if(errors.length) process.exitCode=1; }

const [command,...args]=process.argv.slice(2);
if(command==="sync") console.log(JSON.stringify({items:Object.keys(sync().items).length},null,2));
else if(command==="next") console.log(JSON.stringify(candidates(Number(args[0]||4)),null,2));
else if(command==="publish") publish(args[0],args[1]);
else if(command==="block") block(args[0],args[1]||"blocked",args.slice(2).join(" ")||"Blocked without a safe source.");
else if(command==="verify") verify();
else { console.error("usage: coursework-prep.mjs sync | next [limit] | publish <id> <payload.json> | block <id> <code> <message> | verify"); process.exitCode=2; }
