import { describe, expect, it } from "vitest";
import { parsePracticePaperMarkingModelAnswer } from "@/lib/ai/practice-paper-marking";
import { adaptRecordToPaper } from "@/lib/evaluation/practice-paper-adapter";
import { withCriterionTariffs } from "@/lib/practice/exam-questions";
import { breakdownExamMarkReport } from "@/lib/practice/exam-mark-report";
import { schemeCriteria } from "@/lib/practice/mark-schemes";
import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";

/**
 * Whether one mark of two survives the pipeline against a flattened scheme.
 *
 * The probe's two scoring errors were both partial-credit answers marked
 * against a scheme the harness had collapsed into a single two-mark point, and
 * the conclusion drawn was that awarding one was structurally impossible. That
 * was stronger than the evidence: the marking contract carries a per-criterion
 * `awardedMarks`, precisely so a criterion worth several can be part-credited,
 * and nothing had been shown to reject it.
 *
 * So it is tested rather than argued. If 1 of 2 survives, flattening the
 * scheme is a plausible contributor and not a proof, and the real cause stays
 * open until a run captures the marker's own criterion reports.
 */
const FLATTENED_RECORD = {
  id: "test:flattened",
  sourceId: "medly-gcse",
  level: "gcse",
  subject: "maths",
  regime: "additive",
  questionId: "q",
  questionPrompt: "Compare the two distributions.",
  answer: { kind: "image", paths: ["/dev/null"] },
  humanMarks: [1],
  maxMarks: 2,
  // Prose with no mark notation in it, so the parser cannot find a structure
  // and the adapter must fall back to one whole-tariff point.
  markScheme: "Award two marks for a full comparison of centre and spread with correct values.",
} as unknown as MarkingCorpusRecord;

function flattenedPaper() {
  const adapted = adaptRecordToPaper(FLATTENED_RECORD, {
    answerImages: [{ inlineData: { mimeType: "image/png", data: "x" } }],
  });
  if (!adapted.ok) throw new Error(adapted.reason);
  return adapted.adapted.paper;
}

function markingJson(awarded: number, criterionAwarded: number) {
  return JSON.stringify({
    summary: "Compared the medians only.",
    strengths: [],
    priorities: [],
    questionResults: [
      {
        questionId: "q1",
        label: "Question 1",
        awardedMarks: awarded,
        maxMarks: 2,
        feedback: "The median comparison is correct; the spread is missing.",
        criterionResults: [
          {
            criterionId: "C1",
            criterion: "Full comparison of centre and spread",
            awarded: true,
            awardedMarks: criterionAwarded,
            evidence: "48 > 45",
          },
        ],
        evidence: ["48 > 45"],
        strengths: [],
        improvements: [],
        confidence: "high",
        attempted: true,
      },
    ],
  });
}

describe("a partial award against a single whole-tariff criterion", () => {
  it("builds exactly the flattened shape the probe marked against", () => {
    const item = flattenedPaper().markScheme!.items[0]!;
    expect(item.marking).toBe("additive");
    expect("points" in item ? item.points.length : 0).toBe(1);
    expect("points" in item ? item.points[0]!.marks : 0).toBe(2);
  });

  /*
   * The question this whole test exists to answer. If it passes, "the marker
   * could only return 0 or 2" was wrong.
   */
  it("survives the production parser unchanged", () => {
    const result = parsePracticePaperMarkingModelAnswer(markingJson(1, 1), flattenedPaper());
    expect(result).not.toBeNull();
    const question = result!.questionResults[0]!;
    expect(question.awardedMarks).toBe(1);
    expect(question.criterionResults?.[0]?.awardedMarks).toBe(1);
  });

  /*
   * This is what the investigation actually turned up. The total and the
   * criterion awards disagreed and both reached the student -- a score beside
   * feedback arguing for a different one. It is refused now, which fails the
   * report and puts it through the marker's existing parse-retry.
   */
  it("refuses a total that disagrees with its own criterion awards", () => {
    expect(parsePracticePaperMarkingModelAnswer(markingJson(1, 2), flattenedPaper())).toBeNull();
    expect(parsePracticePaperMarkingModelAnswer(markingJson(2, 1), flattenedPaper())).toBeNull();
  });

  it("is still 1 of 2 after the exam route attaches criterion tariffs", () => {
    const paper = flattenedPaper();
    const parsed = parsePracticePaperMarkingModelAnswer(markingJson(1, 1), paper);
    const withTariffs = withCriterionTariffs(
      parsed!.questionResults[0]!,
      schemeCriteria(paper.markScheme!.items[0]!)
    );
    expect(withTariffs.awardedMarks).toBe(1);
  });

  /*
   * And the student-facing report reads it correctly: one of two credited,
   * with the rest still to get.
   */
  it("reads as partial credit in the mark report", () => {
    const paper = flattenedPaper();
    const parsed = parsePracticePaperMarkingModelAnswer(markingJson(1, 1), paper);
    const withTariffs = withCriterionTariffs(
      parsed!.questionResults[0]!,
      schemeCriteria(paper.markScheme!.items[0]!)
    );
    const breakdown = breakdownExamMarkReport(withTariffs);
    expect(breakdown.earned).toHaveLength(1);
    expect(breakdown.missed).toHaveLength(1);
    expect(breakdown.unexplainedShortfall).toBe(false);
  });

  /*
   * The distinction that must not blur. A mark nobody could reconcile is not a
   * mark that passed a check, and a report that treated the two the same would
   * quietly validate exactly the markings that show their working least.
   */
  it("marks a reconciled result as checked, and says how far the check went", () => {
    const result = parsePracticePaperMarkingModelAnswer(markingJson(1, 1), flattenedPaper());
    expect(result!.questionResults[0]!.markConsistency).toEqual({
      status: "consistent",
      checked: "arithmetic",
    });
  });

  it("never lets an unverifiable result pass as a validated one", () => {
    const noCriteria = JSON.parse(markingJson(1, 1));
    noCriteria.questionResults[0].criterionResults = [];
    const result = parsePracticePaperMarkingModelAnswer(
      JSON.stringify(noCriteria),
      flattenedPaper()
    );
    // It is allowed through -- there is nothing to reconcile it against -- but
    // it carries what it is, and it is not "consistent".
    expect(result).not.toBeNull();
    expect(result!.questionResults[0]!.markConsistency?.status).toBe("unverifiable");
    expect(result!.questionResults[0]!.markConsistency?.checked).toBeUndefined();
  });

  it("clamps only above the tariff, which is the one thing it does change", () => {
    const result = parsePracticePaperMarkingModelAnswer(markingJson(5, 2), flattenedPaper());
    expect(result!.questionResults[0]!.awardedMarks).toBe(2);
  });
});
