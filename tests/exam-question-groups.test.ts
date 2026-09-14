import { describe, expect, it } from "vitest";
import {
  chooseExamQuestionGroups,
  examQuestionGroupKey,
  examQuestionIsComplete,
  groupExamQuestions,
  hardestExamDifficulty,
  orderExamQuestionParts,
} from "@/lib/practice/exam-question-groups";
import type { ExamDifficulty } from "@/lib/practice/exam-questions";

function part(id: string, questionNumber: string, difficulty: ExamDifficulty = "medium", paperId = "paper-1") {
  return { id, paperId, difficulty, provenance: { questionNumber } as never };
}

/**
 * Serving a question whole.
 *
 * Parts used to be drawn one at a time, so a session could hold 26(c) with no
 * 26(a) or 26(b), or 14(b) ahead of 14(a).
 */
describe("which question a part belongs to", () => {
  it("joins the ways boards print a part to their question", () => {
    expect(examQuestionGroupKey(part("a", "14 (b)"))).toBe("paper-1#14");
    expect(examQuestionGroupKey(part("b", "14(a)"))).toBe("paper-1#14");
    expect(examQuestionGroupKey(part("c", "01.1"))).toBe("paper-1#1");
  });

  it("keeps the same number on two papers apart", () => {
    expect(examQuestionGroupKey(part("a", "3(a)", "easy", "paper-1"))).not.toBe(
      examQuestionGroupKey(part("b", "3(a)", "easy", "paper-2"))
    );
  });

  it("lets a question with no readable number stand alone", () => {
    expect(examQuestionGroupKey(part("lonely", ""))).toBe("question#lonely");
    expect(examQuestionGroupKey({ ...part("orphan", "3(a)"), paperId: "" })).toBe("question#orphan");
  });
});

describe("the order parts are shown in", () => {
  it("follows the paper, not the order they were stored", () => {
    const ordered = orderExamQuestionParts([part("c", "14 (c)"), part("a", "14 (a)"), part("b", "14 (b)")]);
    expect(ordered.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("puts 1.2 before 1.10", () => {
    const ordered = orderExamQuestionParts([part("ten", "01.10"), part("two", "01.2")]);
    expect(ordered.map((item) => item.id)).toEqual(["two", "ten"]);
  });
});

describe("gathering parts into questions", () => {
  it("rates a question by its hardest part", () => {
    expect(hardestExamDifficulty(["easy", "hard", "medium"])).toBe("hard");
    const [group] = groupExamQuestions([
      part("a", "26 (a)", "easy"),
      part("b", "26 (b)", "easy"),
      part("c", "26 (c)", "medium"),
    ]);
    expect(group.difficulty).toBe("medium");
    expect(group.parts.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps separate questions separate", () => {
    const groups = groupExamQuestions([part("a", "3(a)"), part("x", "4"), part("b", "3(b)")]);
    expect(groups.map((group) => group.parts.map((item) => item.id))).toEqual([["a", "b"], ["x"]]);
  });
});

/**
 * A part that was never stored cannot be found unservable, so its absence is
 * checked directly: 14(b) must not be served as though it were all of 14.
 */
describe("whether a question has all its parts", () => {
  it("accepts parts that run from (a) without a gap", () => {
    expect(examQuestionIsComplete([part("a", "14 (a)"), part("b", "14 (b)"), part("c", "14 (c)")])).toBe(true);
    expect(examQuestionIsComplete([part("one", "01.1"), part("two", "01.2")])).toBe(true);
  });

  it("accepts a question with no parts", () => {
    expect(examQuestionIsComplete([part("q", "6")])).toBe(true);
  });

  it("refuses a question whose first part is missing", () => {
    expect(examQuestionIsComplete([part("b", "14 (b)"), part("c", "14 (c)")])).toBe(false);
    expect(examQuestionIsComplete([part("two", "01.2")])).toBe(false);
  });

  it("refuses a question with a part missing from the middle", () => {
    expect(examQuestionIsComplete([part("a", "5(a)"), part("c", "5(c)")])).toBe(false);
  });
});

describe("choosing questions for a session", () => {
  const groups = groupExamQuestions([
    part("1a", "1(a)"), part("1b", "1(b)"),
    part("2a", "2(a)"), part("2b", "2(b)"),
    part("3", "3"),
  ]);

  it("counts whole questions, not parts", () => {
    const chosen = chooseExamQuestionGroups(groups, 2, new Set());
    expect(chosen.map((group) => group.parts.length)).toEqual([2, 2]);
  });

  /** Answering 1(b) before means question 1 is a repeat, whichever part it was. */
  it("prefers questions none of whose parts were seen", () => {
    const chosen = chooseExamQuestionGroups(groups, 2, new Set(["1b"]));
    expect(chosen.map((group) => group.key)).toEqual(["paper-1#2", "paper-1#3"]);
  });

  it("falls back to seen questions rather than a short session", () => {
    const chosen = chooseExamQuestionGroups(groups, 3, new Set(["1b", "2a", "3"]));
    expect(chosen).toHaveLength(3);
  });
});
