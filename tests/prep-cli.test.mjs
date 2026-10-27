import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "scripts", "coursework-prep.mjs");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-prep-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "example", "coursework.sample.json"), "utf8"));
  fs.writeFileSync(path.join(dir, "coursework.json"), JSON.stringify(sample));
  fs.writeFileSync(path.join(dir, "coursework-state.json"), JSON.stringify({ "bio110-s2": { status: "done" } }));
  const env = { ...process.env, COURSEWORK_DATA_DIR: dir };
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
  const payload = (kind) => { const f = path.join(dir, `payload-${kind}.json`); fs.writeFileSync(f, JSON.stringify({ kind, summary: "s", proposedResponse: "r", sources: [{ label: "handout", url: "", supports: "methods" }], confidence: "medium" })); return f; };
  return { dir, run, payload };
}

test("sync builds a manifest and blocks items already marked done", (t) => {
  const { dir, run } = fixture(t);
  const r = run("sync");
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "coursework-prep.json"), "utf8"));
  assert.equal(manifest.policy, "prep-only-no-submission");
  assert.equal(manifest.items["bio110-s2"].status, "blocked");
  assert.equal(manifest.items["bio110-a5001"].status, "queued");
});

test("next never offers completed work", (t) => {
  const { run } = fixture(t);
  const next = JSON.parse(run("next", "50").stdout);
  assert.ok(next.length > 0);
  assert.ok(!next.some((c) => c.item.id === "bio110-s2"));
});

test("publish refuses an answer draft for graded or AI-restricted work", (t) => {
  const { run, payload } = fixture(t);
  for (const id of ["bio110-a5001", "his201-a5101", "bio110-q6001"]) {
    const r = run("publish", id, payload("answer-draft"));
    assert.notEqual(r.status, 0, `${id} should be refused`);
    assert.match(r.stderr, /violates/);
  }
});

test("publish writes an immutable revision, verify passes, and progress state is untouched", (t) => {
  const { dir, run, payload } = fixture(t);
  const stateBefore = fs.readFileSync(path.join(dir, "coursework-state.json"), "utf8");
  const first = run("publish", "bio110-a5001", payload("outline"));
  assert.equal(first.status, 0, first.stderr);
  const second = run("publish", "bio110-a5001", payload("outline"));
  assert.equal(second.status, 0, second.stderr);
  assert.notEqual(first.stdout.trim(), second.stdout.trim());
  const artifact = JSON.parse(fs.readFileSync(path.join(dir, first.stdout.trim()), "utf8"));
  assert.equal(artifact.revision, 1);
  assert.match(artifact.notice, /Nothing was entered or submitted/);
  assert.equal(run("publish", "bio110-a5002", payload("answer-draft")).status, 0);
  const verify = run("verify");
  assert.equal(verify.status, 0, verify.stdout);
  assert.equal(JSON.parse(verify.stdout).ok, true);
  assert.equal(fs.readFileSync(path.join(dir, "coursework-state.json"), "utf8"), stateBefore);
});

test("publish rejects ids that could escape the artifact folder", (t) => {
  const { run, payload } = fixture(t);
  assert.notEqual(run("publish", "../../etc", payload("outline")).status, 0);
});

test("CLI prints usage on an unknown command", () => {
  const r = spawnSync(process.execPath, [CLI, "nope"], { encoding: "utf8", env: { ...process.env, COURSEWORK_DATA_DIR: os.tmpdir() } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});
