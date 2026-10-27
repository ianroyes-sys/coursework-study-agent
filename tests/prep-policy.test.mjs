import test from "node:test";
import assert from "node:assert/strict";
import { prepPolicy } from "../lib/courseworkPrep.ts";

const item = (over = {}) => ({ id: "x", course: "C", type: "assignment", title: "Task", due: null, points: null, weightPct: null, note: "", ...over });
const source = (over = {}) => ({ capturedAt: "", instructions: "", description: "", attachments: [], gradeItemId: null, possiblePoints: null, autoExportToGrades: null, attemptsAllowed: null, timeLimitMinutes: null, ...over });

test("instructor AI restrictions win over everything: study support only", () => {
  const p = prepPolicy(item({ points: 100 }), source({ instructions: "Students must do their own work; AI-generated text is not permitted." }));
  assert.equal(p.aiProhibited, true);
  assert.equal(p.kind, "study-guide");
});

test("timed or one-attempt assessments get quiz prep, never answers", () => {
  assert.equal(prepPolicy(item({ type: "quiz" }), null).kind, "quiz-prep");
  assert.equal(prepPolicy(item(), source({ timeLimitMinutes: 20 })).kind, "quiz-prep");
  assert.equal(prepPolicy(item(), source({ attemptsAllowed: 1 })).kind, "quiz-prep");
});

test("anything linked to points or the gradebook gets an outline, not a submission", () => {
  assert.equal(prepPolicy(item({ points: 50 }), null).kind, "outline");
  assert.equal(prepPolicy(item(), source({ gradeItemId: "8001" })).kind, "outline");
  assert.equal(prepPolicy(item({ weightPct: 10 }), null).kind, "outline");
});

test("only explicitly ungraded practice work may get an answer draft", () => {
  const p = prepPolicy(item({ title: "Chapter 4 practice review set" }), source({ autoExportToGrades: false }));
  assert.equal(p.kind, "answer-draft");
  assert.equal(p.gradedEvidence, false);
});

test("unknown grading status defaults to study support", () => {
  assert.equal(prepPolicy(item({ title: "Week 5 worksheet" }), null).kind, "study-guide");
});
