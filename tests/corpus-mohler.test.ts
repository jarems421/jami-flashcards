import { describe, expect, it } from "vitest";
import { maxMarksFor, parseMohler } from "@/lib/evaluation/sources/mohler";
import { humanDisagreement, referenceMark } from "@/lib/evaluation/marking-corpus";

const questions = "1.1 What is the role of a prototype program?\n11.1 How are objects initialized?\n";
const referenceAnswers = "1.1 To simulate the behaviour of portions of the product.\n11.1 By a constructor.\n";

function input(items: Record<string, { answers: string; taScores: string; authorScores: string }>, fileList?: string) {
  return {
    fileList: fileList ?? Object.keys(items).join("\n"),
    questions,
    referenceAnswers,
    items,
  };
}

describe("mohler", () => {
  const oneQuestion = {
    "1.1": {
      answers: "1.1 To simulate portions of the product.\n1.1 It shows the user a first idea.\n",
      taScores: "4\n3\n",
      authorScores: "5\n3\n",
    },
  };

  it("keeps both graders separately rather than the shipped average", () => {
    const { records } = parseMohler(input(oneQuestion));
    expect(records[0].humanMarks).toEqual([4, 5]);
    expect(humanDisagreement(records[0])).toBe(1);
    // The average is available downstream, but it is derived here, not ingested.
    expect(referenceMark(records[0])).toBe(4.5);
  });

  it("counts how often and how widely the two graders disagreed", () => {
    const { stats } = parseMohler(input(oneQuestion));
    expect(stats.gradersDisagreed).toBe(1);
    expect(stats.widestDisagreement).toBe(1);
    expect(stats.ingested).toBe(2);
  });

  it("carries the question and the instructor's answer", () => {
    const { records } = parseMohler(input(oneQuestion));
    expect(records[0].questionPrompt).toBe("What is the role of a prototype program?");
    expect(records[0].markScheme).toBe("To simulate the behaviour of portions of the product.");
    expect(records[0].answer).toEqual({ kind: "text", text: "To simulate portions of the product." });
  });

  /**
   * The README is explicit: only the averaged file was rescaled, so the
   * per-grader files for assignments 11 and 12 are raw and run to ten. Marking
   * them out of five would put most of them out of range and quietly corrupt
   * the rest.
   */
  it("marks assignments 11 and 12 out of ten, as the graders actually scored them", () => {
    expect(maxMarksFor("1.1")).toBe(5);
    expect(maxMarksFor("11.3")).toBe(10);
    expect(maxMarksFor("12.10")).toBe(10);

    const { records, stats } = parseMohler(
      input({ "11.1": { answers: "11.1 By a constructor.\n", taScores: "9\n", authorScores: "7\n" } })
    );
    expect(records[0].maxMarks).toBe(10);
    expect(records[0].humanMarks).toEqual([9, 7]);
    expect(stats.tenPointQuestions).toBe(1);
    expect(stats.outOfRange).toBe(0);
  });

  it("does not rescale a ten-point grade to match the rest", () => {
    const { records } = parseMohler(
      input({ "11.1": { answers: "11.1 By a constructor.\n", taScores: "10\n", authorScores: "0\n" } })
    );
    expect(records[0].humanMarks).toEqual([10, 0]);
  });

  /** The authors exclude these from their own published work. */
  it("skips the selection and ordering questions the authors comment out", () => {
    const result = parseMohler(
      input(oneQuestion, "1.1\n#4.6\n#4.7\n")
    );
    expect(result.stats.excludedByAuthors).toBe(2);
    expect(result.stats.questionsIngested).toBe(1);
  });

  /**
   * The three files are parallel. If they are not the same length the
   * correspondence is broken, and a grade would be attached to a different
   * student's answer than the one it was given for.
   */
  it("skips a question whose answer and grade files do not line up", () => {
    const result = parseMohler(
      input({ "1.1": { answers: "1.1 One.\n1.1 Two.\n", taScores: "4\n", authorScores: "5\n3\n" } })
    );
    expect(result.stats.misalignedQuestions).toBe(1);
    expect(result.records).toHaveLength(0);
    expect(result.issues.join(" ")).toContain("do not line up");
  });

  it("strips the question id and the transport markup from a raw answer", () => {
    const { records } = parseMohler(
      input({ "1.1": { answers: "1.1 A prototype helps.<br><br>\n", taScores: "4\n", authorScores: "4\n" } })
    );
    expect(records[0].answer).toEqual({ kind: "text", text: "A prototype helps." });
  });

  it("skips a grade that cannot fit its question's scale", () => {
    const result = parseMohler(
      input({ "1.1": { answers: "1.1 An answer.\n", taScores: "7\n", authorScores: "4\n" } })
    );
    expect(result.stats.outOfRange).toBe(1);
    expect(result.records).toHaveLength(0);
  });

  it("says so when a listed question has no data behind it", () => {
    const result = parseMohler(input(oneQuestion, "1.1\n9.9\n"));
    expect(result.issues.join(" ")).toContain("9.9");
    expect(result.records).toHaveLength(2);
  });
});
