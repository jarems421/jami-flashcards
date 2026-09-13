import { describe, expect, it } from "vitest";
import {
  EXAM_PRINTED_QUESTION_ASSET_ID,
  examQuestionShowsPrintedPage,
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
