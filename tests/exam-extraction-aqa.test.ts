import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildExamQuestionsFromExtraction,
  summariseExamExtraction,
} from "@/lib/practice/exam-extraction";
import { findQuestionStarts, type PdfPageText } from "@/lib/practice/exam-page-regions";
import type { ExamPaperIngestionManifest } from "@/lib/practice/exam-ingestion-manifest";

/**
 * The same pipeline, against a second board that sets its papers differently.
 *
 * Everything here was calibrated on Edexcel, and against AQA it failed
 * completely and quietly: 216 questions extracted across four papers and not
 * one of them fit to publish. The cause was a single assumption -- that a
 * question's number arrives as one piece of text. AQA prints `0 1 . 1`, one
 * run per glyph, so no label was found, so no region, so no tariff, so
 * everything was held back.
 *
 * Captured from a dry run of the published AQA 8461 June 2023 paper. Page
 * layout and the model's answer only; no PDF bytes.
 */
const fixture = JSON.parse(
  readFileSync("tests/fixtures/aqa-8461-1f-june-2023.json", "utf8")
) as {
  manifest: ExamPaperIngestionManifest;
  paperPages: PdfPageText[];
  schemeText: string;
  capture: {
    questions: Record<string, unknown>[];
    identityMatches: boolean;
    paperSha256: string;
    schemeSha256: string;
  };
};

const RIGHTS = {
  key: "aqa-2026",
  version: 1,
  verified: true,
  storageAllowed: true,
  studentDisplayAllowed: true,
  aiInferenceAllowed: true,
  revoked: false,
};

function build() {
  return buildExamQuestionsFromExtraction({
    manifest: fixture.manifest,
    paperId: "fixture-aqa",
    paperPages: fixture.paperPages,
    schemeText: fixture.schemeText,
    questions: fixture.capture.questions,
    identityMatches: fixture.capture.identityMatches,
    approvedQuestionNumbers: [],
    issuesByQuestion: {},
    rights: RIGHTS,
    paperSha256: fixture.capture.paperSha256,
    schemeSha256: fixture.capture.schemeSha256,
    now: 1_700_000_000_000,
    selectionKey: () => 0.5,
  });
}

describe("AQA's page layout", () => {
  it("finds question numbers that are printed one glyph at a time", () => {
    const starts = findQuestionStarts(fixture.paperPages);
    expect(starts.length).toBeGreaterThan(5);
    // AQA numbers questions 01, 02 …, and parts 01.1, 01.2.
    expect(starts.map((start) => start.label)).toContain("1");
  });

  it("never reports the same question number twice", () => {
    const labels = findQuestionStarts(fixture.paperPages).map((start) => start.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("a real AQA paper, extracted", () => {
  it("keeps every question the model found", () => {
    const summary = summariseExamExtraction(build());
    expect(summary.extracted).toBe(fixture.capture.questions.length);
    expect(summary.rejected).toEqual([]);
  });

  it("locates most questions on the paper", () => {
    const { entries } = build();
    const located = entries.filter((entry) => entry.verification.questionLabelMatches);
    expect(located.length / entries.length).toBeGreaterThan(0.8);
  });

  it("gives located questions their own region rather than a whole page", () => {
    const { entries } = build();
    const withRegion = entries.filter((entry) => entry.regions.length > 0);
    expect(withRegion.length / entries.length).toBeGreaterThan(0.8);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
