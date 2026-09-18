import { describe, expect, it } from "vitest";
import {
  examQuestionPartLabel,
  examSessionPartGroupKey,
  examSessionQuestionRuns,
  examSessionRunAt,
} from "@/lib/practice/exam-question-groups";
import type { ExamQuestion } from "@/lib/practice/exam-questions";

/**
 * A session counted as the questions a student asked for.
 *
 * The mix picks whole questions and the session stores their parts, so a
 * two-question session listed fourteen entries and called itself "Question 1
 * of 14" -- a number the student never chose and could not place against the
 * two they did. Nothing about what is stored, answered or marked changes here;
 * only the counting.
 */
const part = (id: string, questionNumber: string, paper = "8461/1H") =>
  ({
    id,
    provenance: {
      board: "aqa",
      specificationId: "8461",
      componentCode: paper,
      year: 2023,
      series: "June",
      paperReference: paper,
      questionNumber,
    },
  }) as unknown as Pick<ExamQuestion, "id"> & { provenance: ExamQuestion["provenance"] };

describe("reading a session back as its questions", () => {
  it("gathers consecutive parts of one question into one run", () => {
    const runs = examSessionQuestionRuns([
      part("a", "3(a)"),
      part("b", "3(b)"),
      part("c", "3(c)"),
      part("d", "5(a)"),
      part("e", "5(b)"),
    ]);
    expect(runs.map((run) => [run.number, run.from, run.count])).toEqual([
      ["3", 0, 3],
      ["5", 3, 2],
    ]);
  });

  /* Two papers can both print a question 3, and they are not one question. */
  it("keeps the same number on different papers apart", () => {
    const runs = examSessionQuestionRuns([
      part("a", "3(a)", "8461/1H"),
      part("b", "3(a)", "8461/2H"),
    ]);
    expect(runs).toHaveLength(2);
  });

  it("makes an unlettered question a run of its own", () => {
    const runs = examSessionQuestionRuns([part("a", "4"), part("b", "5")]);
    expect(runs.map((run) => run.count)).toEqual([1, 1]);
  });

  /*
   * Runs, not a map: a question that somehow appeared twice in one session
   * stays where it is rather than being pulled across the questions between.
   */
  it("does not merge a question across the ones between it", () => {
    const runs = examSessionQuestionRuns([
      part("a", "3(a)"),
      part("b", "5(a)"),
      part("c", "3(b)"),
    ]);
    expect(runs.map((run) => run.number)).toEqual(["3", "5", "3"]);
  });

  /* A session written before any of this still has to group. */
  it("falls back to one question per part when the label cannot be read", () => {
    const runs = examSessionQuestionRuns([
      { id: "a" } as unknown as ExamQuestion,
      { id: "b" } as unknown as ExamQuestion,
    ]);
    expect(runs.map((run) => run.count)).toEqual([1, 1]);
    expect(examSessionPartGroupKey({ id: "a" } as unknown as ExamQuestion)).toBe("question#a");
  });

  it("says which question a part is in and where in it", () => {
    const runs = examSessionQuestionRuns([
      part("a", "3(a)"),
      part("b", "3(b)"),
      part("c", "5(a)"),
    ]);
    expect(examSessionRunAt(runs, 1)).toMatchObject({ runIndex: 0, partIndex: 1 });
    expect(examSessionRunAt(runs, 2)).toMatchObject({ runIndex: 1, partIndex: 0 });
  });

  it("survives an index outside the session", () => {
    expect(examSessionRunAt([], 3)).toMatchObject({ runIndex: 0, partIndex: 0 });
  });
});

describe("naming a part on its own", () => {
  it("keeps only what the paper adds after the question number", () => {
    expect(examQuestionPartLabel("3(b)")).toBe("(b)");
    expect(examQuestionPartLabel("01.2")).toBe(".2");
  });

  it("gives a whole question no part at all", () => {
    expect(examQuestionPartLabel("4")).toBe("");
    expect(examQuestionPartLabel("")).toBe("");
  });
});
