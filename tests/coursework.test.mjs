import test from "node:test";
import assert from "node:assert/strict";
import { bucketFor, crunchWeeks, daysUntil, hydrate, neededAverage, scoreItem } from "../lib/coursework.ts";

const base = { course: "BIO110", title: "x", dueSource: "d2l-duedate", opens: null, url: "", confidence: "high", note: "" };
const at = (days, hour = 23) => { const d = new Date(2026, 8, 14 + days, hour, 59); return d.toISOString(); };
const NOW = new Date(2026, 8, 14, 9, 0);

test("buckets follow whole calendar days", () => {
  assert.equal(daysUntil(at(0), NOW), 0);
  assert.equal(bucketFor(daysUntil(at(0), NOW)), "today");
  assert.equal(bucketFor(1), "tomorrow");
  assert.equal(bucketFor(5), "week");
  assert.equal(bucketFor(12), "fortnight");
  assert.equal(bucketFor(30), "later");
  assert.equal(bucketFor(-1), "overdue");
  assert.equal(bucketFor(null), "undated");
});

test("finished, skipped and expired items drop out of the ranking", () => {
  const item = { ...base, id: "a", type: "assignment", due: at(1), points: 50, weightPct: null };
  for (const status of ["done", "skipped", "expired"]) assert.equal(scoreItem(item, status, 1, 60), -1);
  assert.ok(scoreItem(item, "todo", 1, 60) > 0);
});

test("a heavy exam a few days out outranks a 5-point discussion due tomorrow", () => {
  const items = [
    { ...base, id: "disc", type: "discussion", due: at(1), points: 5, weightPct: null },
    { ...base, id: "exam", type: "exam", due: at(3), points: null, weightPct: 25 },
  ];
  const ranked = hydrate(items, {}, NOW);
  assert.equal(ranked[0].id, "exam");
  assert.equal(ranked[0].atRisk, true);
});

test("undated work still scores so it stays visible", () => {
  const [item] = hydrate([{ ...base, id: "u", type: "assignment", due: null, dueSource: null, points: null, weightPct: null, confidence: "low" }], {}, NOW);
  assert.equal(item.bucket, "undated");
  assert.ok(item.score > 0);
});

test("state overrides are merged at read time without touching the scrape", () => {
  const raw = [{ ...base, id: "a", type: "quiz", due: at(2), points: 10, weightPct: null }];
  const frozen = JSON.stringify(raw);
  const [item] = hydrate(raw, { a: { status: "doing", effortMin: 90 } }, NOW);
  assert.equal(item.status, "doing");
  assert.equal(item.effortMin, 90);
  assert.equal(JSON.stringify(raw), frozen);
});

test("crunch weeks flag exam weeks inside the horizon", () => {
  const items = hydrate([
    { ...base, id: "e", type: "exam", due: at(9), points: null, weightPct: 25 },
    { ...base, id: "a", type: "assignment", due: at(2), points: 10, weightPct: null },
  ], {}, NOW);
  const crunch = crunchWeeks(items, NOW);
  assert.equal(crunch.length, 1);
  assert.equal(crunch[0].exams, 1);
});

test("needed average refuses to guess on an empty gradebook", () => {
  assert.equal(neededAverage(0, 0, 80), null);
  assert.equal(neededAverage(90, 50, 80), 70);
});
