import { describe, expect, it } from "vitest";
import {
  EXAM_PRINTED_QUESTION_ASSET_ID,
  examQuestionProvenanceLine,
  examQuestionShowsPrintedPage,
  examQuestionTariffNote,
} from "@/lib/practice/exam-question-display";

const printed = { id: EXAM_PRINTED_QUESTION_ASSET_ID, type: "image" as const };

describe("showing a question as printed", () => {
  it("shows an ingested question as its printed page", () => {
    expect(
      examQuestionShowsPrintedPage({ origin: "official_past_paper", assets: [printed] })
    ).toBe(true);
  });

  it("keeps the text for a question Jami wrote", () => {
    expect(examQuestionShowsPrintedPage({ origin: "jami_generated", assets: [printed] })).toBe(false);
  });

  it("keeps the text when there is no printed page, only a figure or none", () => {
    expect(
      examQuestionShowsPrintedPage({
        origin: "official_past_paper",
        assets: [{ id: "figure-1", type: "image" }],
      })
    ).toBe(false);
    expect(examQuestionShowsPrintedPage({ origin: "official_past_paper", assets: [] })).toBe(false);
  });
});

describe("what a question says about itself", () => {
  const provenance = {
    board: "aqa" as const,
    boardLabel: "AQA",
    qualification: "gcse" as const,
    specificationId: "aqa-physics",
    specificationTitle: "Physics",
    componentCode: "8463/1H",
    componentTitle: "Paper 1",
    year: 2023,
    series: "June",
    paperReference: "8463/1H",
    questionNumber: "3",
    sourceUrl: "",
    sourceSha256: "",
  };

  it("names the board, sitting, paper and number of a past-paper question", () => {
    expect(examQuestionProvenanceLine({ origin: "official_past_paper", provenance })).toBe(
      "AQA · June 2023 · 8463/1H · Q3"
    );
  });

  it("gives a question Jami wrote no sitting to be mistaken for", () => {
    expect(examQuestionProvenanceLine({ origin: "jami_generated", provenance })).toBe(
      "Jami-created · not from a past paper"
    );
  });

  it("says what the paper awards beyond the marks Jami marks", () => {
    expect(examQuestionTariffNote({ marks: 30, separateAwardMarks: 4 })).toContain("4 further marks");
    expect(examQuestionTariffNote({ marks: 30, separateAwardMarks: 4 })).toContain("Jami marks the 30");
    expect(examQuestionTariffNote({ marks: 6 })).toBe("");
  });
});
