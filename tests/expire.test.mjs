import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expireCoursework, isExpired, restore } from "../scripts/expire-coursework.mjs";

function fixture(t, generatedAt) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-exp-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, "coursework.json"), JSON.stringify({ generatedAt, items: [
    { id: "late", due: "2026-09-10T23:59:00" },
    { id: "lateish", due: "2026-09-12T23:59:00" },
    { id: "done", due: "2026-09-01T23:59:00" },
    { id: "future", due: "2026-09-20T23:59:00" },
    { id: "undated", due: null },
  ] }));
  fs.writeFileSync(path.join(dataDir, "coursework-state.json"), JSON.stringify({ done: { status: "done" }, late: { status: "doing", note: "keep" } }));
  return dataDir;
}
const NOW = new Date(2026, 8, 14, 9).getTime();

test("a deadline expires only after its local day has fully ended", () => {
  assert.equal(isExpired("2026-09-14T23:59:00", new Date(2026, 8, 14, 23, 0).getTime()), false);
  assert.equal(isExpired("2026-09-14T23:59:00", new Date(2026, 8, 15, 0, 1).getTime()), true);
  assert.equal(isExpired(null, NOW), false);
});

test("fresh scrape: past-due unfinished work expires; done, future and undated stay", (t) => {
  const dataDir = fixture(t, new Date(NOW - 86_400_000).toISOString());
  const r = expireCoursework({ now: NOW, dataDir });
  assert.deepEqual(r.expired.sort(), ["late", "lateish"]);
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, "coursework-state.json"), "utf8"));
  assert.equal(state.late.status, "expired");
  assert.equal(state.late.note, "keep");
  assert.equal(state.done.status, "done");
});

test("stale scrape applies a grace period", (t) => {
  const dataDir = fixture(t, "2026-08-01T00:00:00Z");
  const r = expireCoursework({ now: new Date(2026, 8, 19, 9).getTime(), dataDir, dry: true });
  assert.deepEqual(r.expired, ["late"]);
  assert.equal(r.graceDays, 7);
});

test("restore puts the prior status back", (t) => {
  const dataDir = fixture(t, new Date(NOW).toISOString());
  expireCoursework({ now: NOW, dataDir });
  assert.equal(restore("late", { dataDir }).ok, true);
  assert.equal(restore("lateish", { dataDir }).ok, true);
  const state = JSON.parse(fs.readFileSync(path.join(dataDir, "coursework-state.json"), "utf8"));
  assert.equal(state.late.status, "doing");
  assert.equal(state.lateish.status, undefined);
});
