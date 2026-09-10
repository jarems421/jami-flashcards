import { describe, expect, it, vi } from "vitest";

/**
 * What happens to a mark nobody could reconcile.
 *
 * Labelling it `unverifiable` records the problem and does not answer it: the
 * student still receives a number, and without something downstream it arrives
 * looking exactly like a mark that was checked. So an unreconciled primary
 * buys the second marker, and if that still does not settle it the result is
 * presented as a guide rather than a finished score.
 *
 * Withholding the mark entirely is the third option and is deliberately not
 * taken here -- that is a product decision about whether a student sees
 * anything at all, not something to slip in behind a consistency check.
 */
const generateAiText = vi.hoisted(() => vi.fn());
const countAiInputTokens = vi.hoisted(() => vi.fn(async () => 0));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/provider-router", () => ({ generateAiText, countAiInputTokens }));

const { markSingleQuestionAdaptively } = await import("@/services/ai/practice-paper-marking.server");
const { mapPracticePaperData } = await import("@/lib/practice/practice-papers");

const paper = mapPracticePaperData("paper-1", {
  notebookId: "paper-1",
  folderId: "folder-1",
  title: "Maths",
  status: "submitted",
  assessmentProfile: { qualificationOrModule: "GCSE Maths" },
  questions: [{ id: "q1", label: "Question 1", prompt: "Explain.", marks: 2 }],
  markScheme: {
    kind: "official",
    items: [
      {
        questionId: "q1",
        maxMarks: 2,
        marking: "additive",
        answer: "",
        acceptableAlternatives: [],
        commonMistakes: [],
        points: [
          { id: "m1", marks: 1, code: "M", text: "Method", dep: [], ft: false, essentialTerms: [], allow: [], reject: [] },
          { id: "a1", marks: 1, code: "A", text: "Answer", dep: [], ft: false, essentialTerms: [], allow: [], reject: [] },
        ],
      },
    ],
  },
});

/** A report with a total and no criterion awards to reconcile it against. */
function unreconcilable(awarded: number) {
  return JSON.stringify({
    summary: "Marked.",
    strengths: [],
    priorities: [],
    questionResults: [
      {
        questionId: "q1",
        label: "Question 1",
        awardedMarks: awarded,
        maxMarks: 2,
        feedback: "Some feedback.",
        criterionResults: [],
        evidence: ["the working"],
        strengths: [],
        improvements: [],
        confidence: "high",
        attempted: true,
      },
    ],
  });
}

function input() {
  return {
    paper,
    answerParts: [{ text: "an answer" }],
    deadlineAt: Date.now() + 55_000,
    maxOutputTokens: 2_000,
  };
}

describe("a mark that could not be reconciled", () => {
  it("buys the second marker the confidence signal would not have", async () => {
    generateAiText.mockReset();
    generateAiText.mockResolvedValue(unreconcilable(2));

    const marked = await markSingleQuestionAdaptively(input());

    // One call would be a single marking; the post-check makes it two.
    expect(generateAiText).toHaveBeenCalledTimes(2);
    expect(marked.audit.adaptivelyVerified).toBe(true);
  });

  it("reaches the student flagged rather than as a settled score", async () => {
    generateAiText.mockReset();
    generateAiText.mockResolvedValue(unreconcilable(2));

    const marked = await markSingleQuestionAdaptively(input());

    expect(marked.result.questionResults[0]!.markConsistency?.status).toBe("unverifiable");
    expect(marked.result.questionResults[0]!.markConsistency?.checked).toBeUndefined();
  });

  /*
   * The contrast that makes the signal worth acting on: a report that shows
   * its criterion awards is reconciled, and buys nothing extra.
   */
  it("does not buy a second marker for a mark that reconciles", async () => {
    generateAiText.mockReset();
    const reconciled = JSON.parse(unreconcilable(2));
    reconciled.questionResults[0].criterionResults = [
      { criterionId: "C1", criterion: "Method", awarded: true, awardedMarks: 1, evidence: "seen" },
      { criterionId: "C2", criterion: "Answer", awarded: true, awardedMarks: 1, evidence: "seen" },
    ];
    generateAiText.mockResolvedValue(JSON.stringify(reconciled));

    const marked = await markSingleQuestionAdaptively(input());

    expect(generateAiText).toHaveBeenCalledTimes(1);
    expect(marked.result.questionResults[0]!.markConsistency).toEqual({
      status: "consistent",
      checked: "arithmetic",
    });
  });
});
