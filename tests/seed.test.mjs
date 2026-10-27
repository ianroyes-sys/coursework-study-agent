import test from "node:test";
import assert from "node:assert/strict";
import { shiftDates } from "../scripts/seed-sample.mjs";

test("seed shifts ISO dates and leaves everything else alone", () => {
  const out = shiftDates({ due: "2026-09-14T23:59:00.000Z", day: "2026-09-14", title: "2026-09-14 lab", n: 3, nested: [{ due: null }] }, 10);
  assert.equal(out.due, "2026-09-24T23:59:00.000Z");
  assert.equal(out.day, "2026-09-24");
  assert.equal(out.title, "2026-09-14 lab");
  assert.equal(out.n, 3);
  assert.equal(out.nested[0].due, null);
});
