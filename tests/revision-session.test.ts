import { describe, expect, it } from "vitest";
import { revisionObservations } from "@/lib/learning/profile/revision-signals";
import { closeUnbalancedJson } from "@/lib/ai/model-json";
import {
  explainRevisionLessonRejection,
  matchesExpectedAnswer,
  readRevisionLesson,
  readRevisionMarking,
} from "@/lib/revision/lesson";
import { decodeRevisionSession, serializeRevisionSession } from "@/lib/revision/record";
import {
  advanceRevisionSession,
  createRevisionSteps,
  revisionProgress,
} from "@/lib/revision/session-machine";
import type { RevisionLesson, RevisionSessionRecord, RevisionTask } from "@/lib/revision/types";
import { projectRevisionSession, summariseRevisionSession } from "@/lib/revision/view";

const task = (answer: string): RevisionTask => ({
  prompt: `Question ${[...answer].reverse().join("")}`,
  hint: "Halve the coefficient of $x$.",
  answer,
  markScheme: ["Correct bracket", "Correct constant"],
  solution: "Worked through.",
});

const lesson: RevisionLesson = {
  goals: ["Complete the square", "Solve with it", "Spot when to use it"],
  orientation: "It turns a quadratic into something you can read.",
  explanation: {
    body: "Rewrite $x^2 + bx$ as $(x + b/2)^2 - (b/2)^2$.",
    example: { problem: "$x^2 + 6x + 5$", steps: ["Half of 6 is 3", "$(x+3)^2 - 4$"] },
  },
  guided: task("(x + 4)^2 - 13"),
  independent: task("(x + 5)^2 - 28"),
  apply: task("x = -5 ± 2√7"),
  retrieve: task("Halve b, square it, subtract"),
};

function session(overrides: Partial<RevisionSessionRecord> = {}): RevisionSessionRecord {
  return {
    id: "s1",
    schemaVersion: 1,
    policy: "teach",
    status: "active",
    target: { topicKey: "topic:quadratics", source: "student-topic", conceptLabel: "Completing the square", folderId: "f1" },
    actionId: "folder:f1|low_mastery|topic:topic:quadratics",
    why: [],
    lesson,
    steps: createRevisionSteps("teach"),
    position: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

/** Apply events in order, failing loudly if the machine refuses one. */
function run(record: RevisionSessionRecord, events: Parameters<typeof advanceRevisionSession>[1][]) {
  let current = record;
  for (const event of events) {
    const next = advanceRevisionSession(current, event);
    if (!next.ok) throw new Error(`refused ${event.type}: ${next.reason}`);
    current = { ...current, steps: next.steps, position: next.position };
  }
  return current;
}

const answered = (score: number, at = 2_000) =>
  ({ type: "answered", verdict: score >= 0.8 ? "correct" : score > 0.2 ? "partial" : "incorrect", score, at }) as const;

describe("the Revision Session state machine", () => {
  it("walks the teach path in order and ends", () => {
    const done = run(session(), [
      { type: "continue" }, // orient
      { type: "continue" }, // explain
      answered(1), { type: "continue" }, // guided
      answered(1), { type: "continue" }, // independent
      answered(1), { type: "continue" }, // apply
      answered(1), { type: "continue" }, // retrieve
    ]);
    expect(done.position).toBe(done.steps.length);
    expect(done.steps.map((step) => step.kind)).toEqual([
      "orient", "explain", "guided", "independent", "apply", "retrieve",
    ]);
  });

  it("gives a wrong guided answer one retry, and never a second", () => {
    const afterGuided = run(session(), [
      { type: "continue" }, { type: "continue" }, answered(0), { type: "continue" },
    ]);
    expect(afterGuided.steps[afterGuided.position].kind).toBe("retry");

    const afterRetry = run(afterGuided, [answered(0), { type: "continue" }]);
    expect(afterRetry.steps[afterRetry.position].kind).toBe("independent");
    expect(afterRetry.steps.filter((step) => step.kind === "retry")).toHaveLength(1);
  });

  it("moves partial credit on without a retry", () => {
    const next = run(session(), [
      { type: "continue" }, { type: "continue" }, answered(0.5), { type: "continue" },
    ]);
    expect(next.steps[next.position].kind).toBe("independent");
  });

  it("refuses moves that do not fit where the session is", () => {
    const atGuided = run(session(), [{ type: "continue" }, { type: "continue" }]);
    expect(advanceRevisionSession(atGuided, { type: "continue" })).toEqual({ ok: false, reason: "not_resolved" });
    expect(advanceRevisionSession(session(), answered(1))).toEqual({ ok: false, reason: "not_an_answer_step" });
    const marked = run(atGuided, [answered(1)]);
    expect(advanceRevisionSession(marked, answered(0))).toEqual({ ok: false, reason: "already_resolved" });
  });

  it("keeps the progress row the same length through a retry", () => {
    const retrying = run(session(), [
      { type: "continue" }, { type: "continue" }, answered(0), { type: "continue" },
    ]);
    const progress = revisionProgress(retrying);
    expect(progress.total).toBe(5);
    expect(progress.currentIndex).toBe(1);
  });
});

describe("what the model writes, read without trusting it", () => {
  it("refuses a lesson missing any part of itself", () => {
    expect(readRevisionLesson(lesson)).toEqual(lesson);
    const { apply, ...missing } = lesson;
    void apply;
    expect(readRevisionLesson(missing)).toBeNull();
    expect(readRevisionLesson({ ...lesson, explanation: { ...lesson.explanation, body: "x".repeat(5_000) } })).toBeNull();
  });

  it("reads the shape the model is asked for: the example beside the explanation, solutions as lines", () => {
    const asTheModelWritesIt = {
      ...lesson,
      explanation: lesson.explanation.body,
      example: lesson.explanation.example,
      guided: { ...lesson.guided, solution: ["Half of 8 is 4.", "So $(x+4)^2 - 13$."] },
    };
    expect(readRevisionLesson(asTheModelWritesIt)).toEqual({
      ...lesson,
      guided: { ...lesson.guided, solution: "Half of 8 is 4.\nSo $(x+4)^2 - 13$." },
    });
  });

  it("recovers a lesson the model left one brace short of JSON", () => {
    const written = JSON.stringify({ ...lesson, explanation: lesson.explanation.body, example: lesson.explanation.example });
    expect(() => JSON.parse(written.slice(0, -1))).toThrow();
    expect(readRevisionLesson(JSON.parse(closeUnbalancedJson(written.slice(0, -1))))).toEqual(lesson);
  });

  it("names the fields a refused lesson failed on, and nothing the model wrote", () => {
    const problems = explainRevisionLessonRejection({
      ...lesson,
      goals: ["Only one"],
      retrieve: { ...lesson.retrieve, hint: "" },
      apply: undefined,
    });
    expect(problems).toEqual(["goals has 1 usable of 1", "apply missing", "retrieve.hint empty"]);
    expect(explainRevisionLessonRejection(lesson)).toEqual([]);
  });

  it("holds a mark inside its verdict's band and drops invented error categories", () => {
    expect(readRevisionMarking({ verdict: "correct", score: 0.1, feedback: "Yes." })?.score).toBe(0.8);
    expect(readRevisionMarking({ verdict: "incorrect", score: 0.9, feedback: "Not quite." })?.score).toBe(0.2);
    expect(readRevisionMarking({ verdict: "partial", feedback: "Almost.", errorCategory: "sign_slip" })).toEqual({
      verdict: "partial",
      score: 0.5,
      feedback: "Almost.",
    });
    expect(readRevisionMarking({ verdict: "incorrect", feedback: "Not quite.", errorCategory: "missing_units" })?.errorCategory)
      .toBe("missing_units");
    expect(readRevisionMarking({ verdict: "maybe", feedback: "?" })).toBeNull();
  });

  it("marks an exact answer locally, and never says no", () => {
    expect(matchesExpectedAnswer("(x+4)² − 13", "(x + 4)^2 - 13")).toBe(true);
    expect(matchesExpectedAnswer("-13 + (x+4)^2", "(x + 4)^2 - 13")).toBe(false);
    expect(matchesExpectedAnswer("", "anything")).toBe(false);
  });
});

describe("what the browser may see", () => {
  it("shows no answer or hint before the step is over", () => {
    const atGuided = run(session(), [{ type: "continue" }, { type: "continue" }]);
    const view = JSON.stringify(projectRevisionSession(atGuided));
    expect(view).not.toContain(lesson.guided.answer);
    expect(view).not.toContain(lesson.guided.hint);
    expect(view).not.toContain(lesson.independent.prompt);

    const hinted = run(atGuided, [{ type: "hint" }]);
    expect(JSON.stringify(projectRevisionSession(hinted))).toContain(lesson.guided.hint);
    expect(JSON.stringify(projectRevisionSession(hinted))).not.toContain(lesson.guided.answer);

    const over = run(atGuided, [answered(1)]);
    expect(JSON.stringify(projectRevisionSession(over))).toContain(lesson.guided.answer);
  });

  it("ticks only what was done well, and names the hardest part", () => {
    const steps = run(session(), [
      { type: "continue" }, { type: "continue" },
      answered(1), { type: "continue" },
      answered(1), { type: "continue" },
      answered(0), { type: "continue" },
      answered(1), { type: "continue" },
    ]).steps;
    const summary = summariseRevisionSession(steps);
    expect(summary.earned).toEqual([
      "Worked one through with Jami",
      "Did one on your own",
      "Explained it back without looking",
    ]);
    expect(summary.note).toContain("unfamiliar question");
    expect(summary.answered).toBe(4);
  });

  it("round-trips through storage without the undefined Firestore refuses", () => {
    const stored = serializeRevisionSession(session());
    expect(JSON.stringify(stored)).not.toContain("undefined");
    expect(decodeRevisionSession("s1", stored)).toEqual(session());
  });
});

describe("what the Learning Engine is given", () => {
  const finished = run(session(), [
    { type: "continue" }, { type: "continue" },
    answered(1, 3_000), { type: "continue" },
    answered(0.5, 4_000), { type: "continue" },
    { type: "skipped", at: 5_000 }, { type: "continue" },
    { type: "self-graded", correct: true, at: 6_000 }, { type: "continue" },
  ]);
  const observations = revisionObservations([
    {
      id: "s1",
      actionId: finished.actionId ?? "",
      topicKey: finished.target.topicKey,
      completedAt: 1_789_000_000_000,
      steps: finished.steps.map((step) => ({ ...step, resolvedAt: 1_789_000_000_000 })),
    },
  ]);

  it("counts only the independent steps, never the guided one or a self-grade", () => {
    expect(observations.map((observation) => observation.itemId)).toEqual([
      "revision:s1:independent",
      "revision:s1:apply",
    ]);
  });

  it("scores a skip as nothing known, and tags the recommendation", () => {
    expect(observations.map((observation) => observation.score)).toEqual([0.5, 0]);
    for (const observation of observations) {
      expect(observation.kind).toBe("revision");
      expect(observation.interventionId).toBe(finished.actionId);
      expect(observation.topicKeys).toEqual(["topic:quadratics"]);
    }
  });
});
