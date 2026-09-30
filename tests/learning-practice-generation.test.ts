import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRACTICE_QUESTIONS,
  MAX_PRACTICE_QUESTIONS,
  MAX_QUESTION_MARKS,
  MIN_PRACTICE_QUESTIONS,
  buildPracticeRequest,
  practiceGenerationPrompt,
  readPracticeDrafts,
} from "@/lib/learning/interventions/practice-request";
import { practiceToStore } from "@/lib/learning/interventions/practice-store";
import { servableExamSpecificationConcepts } from "@/lib/practice/exam-specification-concepts";

/**
 * Generating questions that can actually be marked.
 *
 * A flashcard marks itself; a question does not. One without a scheme that
 * accounts for its own tariff is work a student could do that Jami cannot
 * read, so it never becomes a question at all.
 */

const SPEC = "8300";
const CONCEPT = servableExamSpecificationConcepts(SPEC)[0]?.id ?? "";
const INTERVENTION = "folder:f1|low_mastery|spec:x";

function request(overrides: Record<string, unknown> = {}) {
  return buildPracticeRequest({
    conceptId: CONCEPT,
    conceptLabel: "Ordering integers",
    specificationId: SPEC,
    interventionId: INTERVENTION,
    ...overrides,
  });
}

const GOOD = {
  prompt: "Order these from smallest to largest.",
  marks: 3,
  answer: "Compare place value, then order.",
  points: [
    { marks: 1, text: "Compares the integer parts" },
    { marks: 2, text: "Orders all five correctly" },
  ],
};

describe("asking for questions on a real concept", () => {
  it("accepts a concept the catalogue holds", () => {
    const built = request();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.conceptId).toBe(CONCEPT);
    expect(built.request.requestedCount).toBe(DEFAULT_PRACTICE_QUESTIONS);
  });

  it("cannot invent a specification concept", () => {
    expect(request({ conceptId: "not-real" })).toEqual({ ok: false, reason: "unknown_concept" });
  });

  it("refuses without a course or an intervention", () => {
    expect(request({ specificationId: "" }).ok).toBe(false);
    expect(request({ interventionId: "" })).toEqual({
      ok: false,
      reason: "missing_intervention",
    });
  });

  it("keeps the count inside what a targeted set should be", () => {
    const many = request({ requestedCount: 99 });
    const few = request({ requestedCount: 1 });
    expect(many.ok && many.request.requestedCount).toBe(MAX_PRACTICE_QUESTIONS);
    expect(few.ok && few.request.requestedCount).toBe(MIN_PRACTICE_QUESTIONS);
  });

  it("tells the model the tariff rule it will be held to", () => {
    const built = request();
    if (!built.ok) throw new Error("expected a request");
    expect(practiceGenerationPrompt(built.request)).toContain("add up exactly");
  });
});

describe("judging what came back", () => {
  it("keeps a question whose scheme accounts for its marks", () => {
    const read = readPracticeDrafts([GOOD]);
    expect(read.ok && read.questions).toHaveLength(1);
  });

  it("refuses a question whose scheme does not add up", () => {
    // Four marks, a scheme awarding three: the marking would be fiction.
    const read = readPracticeDrafts([{ ...GOOD, marks: 4 }]);
    expect(read).toEqual({ ok: false, reason: "schemes_disagree_with_marks" });
  });

  it("refuses a question with no scheme at all", () => {
    const read = readPracticeDrafts([{ prompt: "Do this", marks: 2, answer: "x" }]);
    expect(read).toEqual({ ok: false, reason: "no_usable_questions" });
  });

  it("refuses a question with no worked answer", () => {
    const read = readPracticeDrafts([{ ...GOOD, answer: "" }]);
    expect(read.ok).toBe(false);
  });

  it("refuses a tariff no short question should carry", () => {
    const read = readPracticeDrafts([
      { ...GOOD, marks: MAX_QUESTION_MARKS + 1, points: [{ marks: MAX_QUESTION_MARKS + 1, text: "x" }] },
    ]);
    expect(read.ok).toBe(false);
  });

  it("keeps the good ones and counts what it dropped", () => {
    const read = readPracticeDrafts([GOOD, { ...GOOD, marks: 9 }, { nonsense: true }]);
    expect(read.ok && read.questions).toHaveLength(1);
    expect(read.ok && read.dropped).toBe(2);
  });

  it("fails closed on nothing at all", () => {
    expect(readPracticeDrafts([])).toEqual({ ok: false, reason: "no_usable_questions" });
    expect(readPracticeDrafts("not an array")).toEqual({
      ok: false,
      reason: "no_usable_questions",
    });
  });
});

describe("what gets stored, once the student agrees", () => {
  it("produces the shapes the existing pipeline already marks", () => {
    const { questions, markScheme } = practiceToStore([GOOD, GOOD], {
      conceptId: CONCEPT,
      interventionId: INTERVENTION,
    });
    expect(questions).toHaveLength(2);
    expect(markScheme).toHaveLength(2);
    // Every question is markable by its own scheme.
    for (const [index, question] of questions.entries()) {
      expect(markScheme[index]?.questionId).toBe(question.id);
      expect(markScheme[index]?.maxMarks).toBe(question.marks);
    }
  });

  it("attaches the canonical concept to every question", () => {
    const { questions } = practiceToStore([GOOD], {
      conceptId: CONCEPT,
      interventionId: INTERVENTION,
    });
    // This is what lands the resulting attempts on the right concept.
    expect(questions[0]?.conceptIds).toEqual([CONCEPT]);
  });

  it("stores a scheme whose points still add to the tariff", () => {
    const { markScheme } = practiceToStore([GOOD], {
      conceptId: CONCEPT,
      interventionId: INTERVENTION,
    });
    const item = markScheme[0];
    if (!item || item.marking !== "additive") throw new Error("expected an additive scheme");
    const total = item.points.reduce((sum, point) => sum + point.marks, 0);
    expect(total).toBe(item.maxMarks);
  });

  it("creates no attempt, because nobody has sat anything", () => {
    const { questions } = practiceToStore([GOOD], {
      conceptId: CONCEPT,
      interventionId: INTERVENTION,
    });
    // Questions are material. Evidence arrives when they are answered.
    expect(questions[0]).not.toHaveProperty("result");
    expect(questions[0]).not.toHaveProperty("awardedMarks");
  });
});
