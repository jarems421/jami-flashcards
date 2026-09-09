import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildExamQuestionsFromExtraction,
  summariseExamExtraction,
} from "@/lib/practice/exam-extraction";
import type { PdfPageText } from "@/lib/practice/exam-page-regions";
import type { ExamPaperIngestionManifest } from "@/lib/practice/exam-ingestion-manifest";

/**
 * The whole extraction pipeline, run offline against a real paper.
 *
 * Captured from the published Edexcel 1MA1/1H, June 2023 -- its page layout,
 * its mark scheme text, and the model's own answer from a live dry run. No PDF
 * bytes, so nothing licensed is in the repository and nothing here calls out.
 *
 * This exists because the extraction was changed three times on the strength
 * of a slow paid run against a live board, and two of those changes were
 * broken. Every one of those mistakes would have failed here in a second.
 */
const fixture = JSON.parse(
  readFileSync("tests/fixtures/edexcel-1ma1-1h-june-2023.json", "utf8")
) as {
  manifest: ExamPaperIngestionManifest;
  paperPages: PdfPageText[];
  schemeText: string;
  capture: {
    questions: Record<string, unknown>[];
    identityMatches: boolean;
    approvedQuestionNumbers: string[];
    issuesByQuestion: Record<string, string[]>;
    paperSha256: string;
    schemeSha256: string;
  };
};

const RIGHTS = {
  key: "pearson_edexcel-2026",
  version: 1,
  verified: true,
  storageAllowed: true,
  studentDisplayAllowed: true,
  aiInferenceAllowed: true,
  revoked: false,
};

function build(overrides: Partial<Parameters<typeof buildExamQuestionsFromExtraction>[0]> = {}) {
  return buildExamQuestionsFromExtraction({
    manifest: fixture.manifest,
    paperId: "fixture-paper",
    paperPages: fixture.paperPages,
    schemeText: fixture.schemeText,
    questions: fixture.capture.questions,
    identityMatches: fixture.capture.identityMatches,
    approvedQuestionNumbers: fixture.capture.approvedQuestionNumbers,
    issuesByQuestion: fixture.capture.issuesByQuestion ?? {},
    rights: RIGHTS,
    paperSha256: fixture.capture.paperSha256,
    schemeSha256: fixture.capture.schemeSha256,
    now: 1_700_000_000_000,
    selectionKey: () => 0.5,
    ...overrides,
  });
}

describe("a real Edexcel paper, extracted", () => {
  it("keeps every question the model found", () => {
    const summary = summariseExamExtraction(build());
    expect(summary.extracted).toBe(28);
    expect(summary.rejected).toEqual([]);
  });

  it("locates every question on the paper and pairs every scheme", () => {
    const { entries } = build();
    const failures = entries.filter(
      (entry) => !entry.verification.questionLabelMatches || !entry.verification.markSchemeLabelMatches
    );
    expect(failures.map((entry) => entry.question.provenance.questionNumber)).toEqual([]);
  });

  /*
   * The tariff check is the one that read a question number as a mark total.
   * On this paper every tariff is printed as "(Total for Question N is M
   * marks)", so every one of them should be confirmed against the paper.
   */
  it("confirms every tariff against the one printed on the paper", () => {
    const { entries } = build();
    const mismatched = entries.filter((entry) => !entry.verification.tariffMatches);
    expect(mismatched.map((entry) => entry.question.provenance.questionNumber)).toEqual([]);
  });

  it("gives each question its own region rather than a whole page", () => {
    const { entries } = build();
    expect(entries.every((entry) => entry.regions.length > 0)).toBe(true);
    // A region that covers the entire page means the boundary was not found.
    const wholePage = entries.filter((entry) =>
      entry.regions.some((region) => region.fromRatio === 0 && region.toRatio === 1)
    );
    expect(wholePage.length).toBeLessThan(entries.length);
  });

  it("produces a mark scheme whose points add up to the tariff", () => {
    const { entries } = build();
    const wrong = entries.filter((entry) => !entry.verification.questionComplete);
    expect(wrong.map((entry) => entry.question.provenance.questionNumber)).toEqual([]);
  });

  it("is deterministic, so a rerun cannot quietly differ", () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe("what the pipeline refuses", () => {
  it("publishes nothing when the paper is not the one in the manifest", () => {
    const summary = summariseExamExtraction(build({ identityMatches: false }));
    expect(summary.published).toBe(0);
    expect(summary.needsReview).toBe(28);
  });

  it("publishes a whole real paper when every check compares cleanly", () => {
    const summary = summariseExamExtraction(build());
    expect(summary.published).toBe(28);
    expect(summary.needsReview).toBe(0);
  });

  /*
   * The regression that shipped: the prompt lost its schema and every question
   * came back with a regime and no awardable points. It read as "0 published,
   * 0 needing review", which was indistinguishable from an empty paper.
   */
  it("reports questions whose scheme has no mark points, rather than passing them", () => {
    const stripped = fixture.capture.questions.map((question) => ({
      ...question,
      markSchemeItem: { marking: "additive" },
    }));
    const result = build({ questions: stripped });
    const summary = summariseExamExtraction(result);
    // A regime with no points still parses, so these are kept and held back
    // rather than dropped -- which is what "0 published, 28 needing review"
    // meant when it happened for real.
    expect(summary.published).toBe(0);
    expect(summary.needsReview).toBe(28);
    expect(result.entries[0].verification.issues.join(" ")).toContain("Points total 0");
  });

  /*
   * A paper prints one total per question and a question may be several parts,
   * so what must match is the sum of the parts. Comparing each part against
   * the whole question's total failed every multi-part question on a real
   * paper -- eight of twenty-eight -- while the extraction was correct.
   */
  it("compares the sum of a question's parts against its printed total", () => {
    const { entries } = build();
    const parts = entries.filter((entry) => /\(/.test(entry.question.provenance.questionNumber));
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((entry) => entry.verification.tariffMatches)).toBe(true);
  });

  it("catches a tariff that disagrees with the paper", () => {
    const inflated = fixture.capture.questions.map((question) => ({ ...question, marks: 99 }));
    const { entries } = build({ questions: inflated });
    const confirmed = entries.filter((entry) => entry.verification.tariffMatches);
    expect(confirmed).toEqual([]);
    expect(summariseExamExtraction({ entries, rejected: [] }).published).toBe(0);
  });

  it("catches a question the mark scheme never covers", () => {
    const renumbered = fixture.capture.questions.map((question) => ({
      ...question,
      questionNumber: "97",
    }));
    const { entries, rejected } = build({ questions: renumbered });
    const covered = entries.filter((entry) => entry.verification.markSchemeLabelMatches);
    expect(covered).toEqual([]);
    expect(entries.length + rejected.length).toBe(28);
  });
});

/**
 * A question carries a version of its own content, so re-ingesting a paper
 * cannot silently change what a live session is marked against.
 */
describe("content versions", () => {
  it("gives every question a version, and its scheme the same one", () => {
    const { entries } = build();
    expect(entries.every((entry) => entry.question.contentVersion.length > 0)).toBe(true);
    expect(
      entries.every((entry) => entry.secret.contentVersion === entry.question.contentVersion)
    ).toBe(true);
  });

  it("gives the same content the same version, so an unchanged re-ingest archives nothing", () => {
    const first = build();
    const second = build();
    expect(first.entries.map((entry) => entry.question.contentVersion)).toEqual(
      second.entries.map((entry) => entry.question.contentVersion)
    );
  });

  it("changes the version when the wording changes", () => {
    const reworded = fixture.capture.questions.map((question) => ({
      ...question,
      prompt: `${String(question.prompt)} (reworded)`,
    }));
    const before = build().entries[0].question.contentVersion;
    const after = build({ questions: reworded }).entries[0].question.contentVersion;
    expect(after).not.toBe(before);
  });

  it("changes the version when only the mark scheme changes", () => {
    const rescheme = fixture.capture.questions.map((question) => ({
      ...question,
      markSchemeItem: {
        ...(question.markSchemeItem as Record<string, unknown>),
        answer: "a different official answer",
      },
    }));
    const before = build().entries[0].question.contentVersion;
    const after = build({ questions: rescheme }).entries[0].question.contentVersion;
    expect(after).not.toBe(before);
  });
});
