#!/usr/bin/env node
// Marks unfinished coursework whose due day has fully ended as "expired" so the queue shows
// live work instead of history. Reversible, and it never marks anything done.
//
// Only your state file (coursework-state.json) is written; the scraped coursework.json is
// never edited. When the scrape is more than a week old it cannot prove a date is still
// current, so a grace period applies and only clearly-past work expires.
//
//   node scripts/expire-coursework.mjs [--dry]          cull
//   node scripts/expire-coursework.mjs --restore <id>   put one item back
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCRAPE_STALE_DAYS = 7;
export const GRACE_DAYS = 7;
const DAY = 86_400_000;

const dataDir = (opts = {}) => opts.dataDir || path.resolve(process.cwd(), process.env.COURSEWORK_DATA_DIR || "data");
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/** Local calendar day (YYYY-MM-DD) of a date-only string or a timestamp. */
export function toLocalDay(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True once the deadline's local day (plus grace) has fully ended. */
export function isExpired(deadline, now = Date.now(), graceDays = 0) {
  const day = toLocalDay(deadline);
  if (!day) return false;
  const [y, m, d] = day.split("-").map(Number);
  return now >= new Date(y, m - 1, d + 1 + graceDays).getTime();
}

export function expireCoursework({ now = Date.now(), dry = false, ...opts } = {}) {
  const dir = dataDir(opts);
  const work = readJson(path.join(dir, "coursework.json"), null);
  if (!work) return { expired: [], scrapeAgeDays: null, graceDays: 0 };
  const stateFile = path.join(dir, "coursework-state.json");
  const state = readJson(stateFile, {});
  const generated = Date.parse(work.generatedAt || "");
  const scrapeAgeDays = Number.isFinite(generated) ? Math.floor((now - generated) / DAY) : null;
  const graceDays = scrapeAgeDays == null || scrapeAgeDays > SCRAPE_STALE_DAYS ? GRACE_DAYS : 0;
  const expired = [];
  for (const item of work.items || []) {
    const status = state[item.id]?.status;
    if (["done", "skipped", "expired"].includes(status)) continue;
    if (!item.due || !isExpired(item.due, now, graceDays)) continue;
    expired.push(item.id);
    if (!dry) state[item.id] = { ...state[item.id], status: "expired", expiredAt: new Date(now).toISOString(), ...(status ? { priorStatus: status } : {}) };
  }
  if (expired.length && !dry) writeAtomic(stateFile, state);
  return { expired, scrapeAgeDays, graceDays };
}

export function restore(id, opts = {}) {
  const stateFile = path.join(dataDir(opts), "coursework-state.json");
  const state = readJson(stateFile, {});
  const cur = { ...state[id] };
  if (cur.status !== "expired") return { ok: false, id, detail: "not expired" };
  if (cur.priorStatus) cur.status = cur.priorStatus; else delete cur.status;
  delete cur.priorStatus;
  delete cur.expiredAt;
  state[id] = cur;
  writeAtomic(stateFile, state);
  return { ok: true, id };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const r = args[0] === "--restore" ? restore(args[1]) : expireCoursework({ dry: args.includes("--dry") });
  console.log(JSON.stringify(r, null, 2));
}
