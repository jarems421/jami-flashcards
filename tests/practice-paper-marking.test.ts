import { describe, expect, it } from "vitest";
import {
  mergePracticePaperQuestionRemark,
  parsePracticePaperMarkingModelAnswer,
} from "@/lib/ai/practice-paper-marking";
import { mapPracticePaperData } from "@/lib/practice/practice-papers";
import {
  applyPracticePaperMarkCorrection,
  calculatePracticePaperPercentage,
  getPracticePaperGradeLabel,
} from "@/lib/practice/practice-papers";

const paper = mapPracticePaperData("paper-1", {
  notebookId: "paper-1",
  folderId: "folder-1",
  title: "Test paper",
  status: "submitted",
  questions: [
    { id: "q1", label: "Question 1", prompt: "One", marks: 2 },
    { id: "q2", label: "Question 2", prompt: "Two", marks: 3 },
  ],
  markScheme: {
    kind: "generated",
    items: [
      { questionId: "q1", answer: "One", criteria: [], acceptableAlternatives: [], commonMistakes: [] },
      { questionId: "q2", answer: "Two", criteria: [], acceptableAlternatives: [], commonMistakes: [] },
    ],
  },
});

describe("practice-paper marking response", () => {
  it("uses the fixed paper marks rather than model-provided maxima", () => {
    const result = parsePracticePaperMarkingModelAnswer(
      JSON.stringify({
        summary: "Good progress.",
        strengths: ["Clear method"],
        priorities: ["Check units"],
        questionResults: [
          {
            questionId: "q1",
            awardedMarks: 9,
            maxMarks: 9,
            feedback: "Method shown.",
            evidence: ["The student showed the required method."],
            strengths: [],
            improvements: [],
            confidence: "high",
          },
          {
            questionId: "q2",
            awardedMarks: 2,
            maxMarks: 3,
            feedback: "One step missing.",
            evidence: ["The student completed the first two steps."],
            strengths: [],
            improvements: ["Show the final substitution"],
            confidence: "medium",
          },
        ],
      }),
      paper
    );
    expect(result).toMatchObject({
      awardedMarks: 4,
      totalMarks: 5,
      percentage: 80,
    });
    expect(result?.questionResults[0]).toMatchObject({
      questionId: "q1",
      awardedMarks: 2,
      maxMarks: 2,
    });
  });

  it("rejects a report that silently omits a question", () => {
    expect(
      parsePracticePaperMarkingModelAnswer(
        JSON.stringify({
          questionResults: [
            {
              questionId: "q1",
              awardedMarks: 1,
              maxMarks: 2,
              feedback: "Partial credit.",
              strengths: [],
              improvements: [],
              confidence: "high",
            },
          ],
        }),
        paper
      )
    ).toBeNull();
  });

  it("marks every optional question but counts only the required best result", () => {
    const choicePaper = mapPracticePaperData("choice-paper", {
      ...paper,
      questions: [
        { id: "q1", label: "Question 1", prompt: "Required", marks: 5 },
        { id: "q2", label: "Question 2", prompt: "Option A", marks: 10 },
        { id: "q3", label: "Question 3", prompt: "Option B", marks: 10 },
      ],
      choiceGroups: [{
        id: "choice-1",
        label: "Answer one",
        requiredCount: 1,
        questionIds: ["q2", "q3"],
        selectionRule: "highest_scoring",
      }],
    });
    const result = parsePracticePaperMarkingModelAnswer(JSON.stringify({
      questionResults: [
        { questionId: "q1", awardedMarks: 4, maxMarks: 5, evidence: ["Required method"], feedback: "", strengths: [], improvements: [], confidence: "high", attempted: true },
        { questionId: "q2", awardedMarks: 3, maxMarks: 10, evidence: ["Partial response"], feedback: "", strengths: [], improvements: [], confidence: "high", attempted: true },
        { questionId: "q3", awardedMarks: 8, maxMarks: 10, evidence: ["Developed response"], feedback: "", strengths: [], improvements: [], confidence: "high", attempted: true },
      ],
    }), choicePaper);
    expect(result).toMatchObject({ awardedMarks: 12, totalMarks: 15, percentage: 80 });
    expect(result?.questionResults.find((item) => item.questionId === "q2")?.counted).toBe(false);
    expect(result?.questionResults.find((item) => item.questionId === "q3")?.counted).toBe(true);
  });

  it("recalculates grade guidance after a manual correction", () => {
    const result = applyPracticePaperMarkCorrection({
      awardedMarks: 7,
      totalMarks: 10,
      percentage: 70,
      summary: "",
      strengths: [],
      priorities: [],
      questionResults: [{ questionId: "q1", label: "Q1", awardedMarks: 7, maxMarks: 10, feedback: "", strengths: [], improvements: [], confidence: "low", counted: true, attempted: true }],
    }, "q1", 8, "Handwriting was misread", {
      kind: "official",
      label: "Boundaries",
      notice: "Official",
      boundaries: [{ label: "A", minimumPercentage: 80 }],
    });
    expect(result).toMatchObject({ awardedMarks: 8, percentage: 80, gradeLabel: "A" });
    expect(result.questionResults[0].manualReason).toBe("Handwriting was misread");
  });

  it("merges a question-only AI recheck and recalculates the total", () => {
    const current = parsePracticePaperMarkingModelAnswer(JSON.stringify({
      summary: "Initial report",
      strengths: [],
      priorities: [],
      questionResults: [
        { questionId: "q1", awardedMarks: 1, maxMarks: 2, evidence: ["Partial answer"], feedback: "", strengths: [], improvements: [], confidence: "low", attempted: true },
        { questionId: "q2", awardedMarks: 2, maxMarks: 3, evidence: ["Two credit points"], feedback: "", strengths: [], improvements: [], confidence: "high", attempted: true },
      ],
    }), paper);
    expect(current).not.toBeNull();
    const merged = mergePracticePaperQuestionRemark({
      paper,
      current: current!,
      replacement: {
        ...current!.questionResults[0],
        awardedMarks: 2,
        confidence: "high",
        manualReason: "AI recheck: final line was faint",
      },
    });
    expect(merged).toMatchObject({ awardedMarks: 4, totalMarks: 5, percentage: 80 });
    expect(merged?.questionResults[0].manualReason).toContain("AI recheck");
  });
});

/**
 * A tenth of a percent claims a precision this marking does not have, and
 * rounding one up walks a student across a boundary they did not reach.
 */
describe("practice-paper percentage", () => {
  const guidance = {
    kind: "official" as const,
    label: "Grades",
    notice: "",
    boundaries: [{ label: "Grade 7", minimumPercentage: 70 }],
  };

  it("floors to a whole number rather than rounding", () => {
    expect(calculatePracticePaperPercentage(48, 69)).toBe(69);
    expect(calculatePracticePaperPercentage(2, 3)).toBe(66);
  });

  it("never rounds a near miss up across a grade boundary", () => {
    const percentage = calculatePracticePaperPercentage(174, 250);
    expect(percentage).toBe(69);
    expect(getPracticePaperGradeLabel(percentage, guidance)).toBeUndefined();
  });

  it("still awards the boundary when it is genuinely reached", () => {
    const percentage = calculatePracticePaperPercentage(175, 250);
    expect(percentage).toBe(70);
    expect(getPracticePaperGradeLabel(percentage, guidance)).toBe("Grade 7");
  });

  it("is zero when the paper carries no marks", () => {
    expect(calculatePracticePaperPercentage(0, 0)).toBe(0);
  });
});

/**
 * Marking ran half a mark generous through every attempt to fix it, and the one
 * that asked the marker to check its working changed nothing -- 12 marks fixed
 * against 9 broken, p = 0.66. Asking did not work, so the comparison is
 * required in the output instead: a marker that has to write down what the
 * guide wants and what the candidate produced is in a different position from
 * one told to be careful.
 */
describe("the comparison behind a criterion verdict", () => {
  const reportWith = (criterion: Record<string, unknown>) =>
    JSON.stringify({
      summary: "Report.",
      strengths: [],
      priorities: [],
      questionResults: [
        {
          questionId: "q1",
          label: "Question 1",
          awardedMarks: 1,
          maxMarks: 2,
          feedback: "Feedback.",
          criterionResults: [criterion],
          evidence: ["y - 7 = 10(x - 1)"],
          strengths: [],
          improvements: [],
          confidence: "high",
        },
        {
          questionId: "q2",
          label: "Question 2",
          awardedMarks: 3,
          maxMarks: 3,
          feedback: "Feedback.",
          evidence: ["Complete."],
          strengths: [],
          improvements: [],
          confidence: "high",
        },
      ],
    });

  const firstCriterion = (raw: string) =>
    parsePracticePaperMarkingModelAnswer(raw, paper)?.questionResults[0].criterionResults?.[0];

  it("keeps what the guide wanted beside what the candidate produced", () => {
    expect(
      firstCriterion(
        reportWith({
          criterionId: "C1",
          criterion: "calculate the gradient",
          schemeValue: "7",
          candidateValue: "10",
          awarded: false,
          evidence: "y - 7 = 10(x - 1)",
        })
      )
    ).toMatchObject({ criterionId: "C1", schemeValue: "7", candidateValue: "10", awarded: false });
  });

  /**
   * Every marking already stored predates these fields, and a qualitative
   * criterion may have no single value to state. Neither may stop a report
   * loading.
   */
  it("still reads a report that carries neither", () => {
    const criterion = firstCriterion(
      reportWith({ criterionId: "C1", criterion: "gradient", awarded: true, evidence: "m = 7" })
    );
    expect(criterion?.awarded).toBe(true);
    expect(criterion?.schemeValue).toBeUndefined();
    expect(criterion?.candidateValue).toBeUndefined();
  });

  /**
   * A section worth ten marks says nothing useful through a boolean, so the
   * marker states how many it gave. The first typed run reported none of sixty,
   * which is either a marker that will not say or a parser that drops it, and
   * those need telling apart.
   */
  it("keeps how many marks the criterion earned", () => {
    const criterion = firstCriterion(
      reportWith({
        criterionId: "C1",
        criterion: "Knowledge and understanding",
        awarded: true,
        awardedMarks: 6,
        evidence: "the candidate's paragraph on devolution",
      })
    );
    expect(criterion?.awardedMarks).toBe(6);
  });

  it("leaves it out where the marker gave only a verdict", () => {
    const criterion = firstCriterion(
      reportWith({ criterionId: "C1", criterion: "Knowledge", awarded: true, evidence: "e" })
    );
    expect(criterion?.awardedMarks).toBeUndefined();
    expect(criterion?.awarded).toBe(true);
  });

  it("caps them, so a marker cannot restate the whole scheme in one", () => {
    const criterion = firstCriterion(
      reportWith({
        criterionId: "C1",
        criterion: "gradient",
        schemeValue: "x".repeat(500),
        candidateValue: "y".repeat(500),
        awarded: true,
        evidence: "m = 7",
      })
    );
    expect(criterion?.schemeValue?.length).toBeLessThanOrEqual(200);
    expect(criterion?.candidateValue?.length).toBeLessThanOrEqual(200);
  });
});
