import { describe, expect, it } from "vitest";
import {
  applyPracticePaperMarkRanges,
  MARKING_CALIBRATION_PROFILES,
  UNCALIBRATED_NOTE,
} from "@/lib/evaluation/marking-calibration";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  mapPracticePaperData,
  mapPracticePaperMarkingJobData,
  type PracticePaperResult,
} from "@/lib/practice/practice-papers";

const paper = mapPracticePaperData("paper-1", {
  notebookId: "paper-1",
  folderId: "folder-1",
  title: "A-level Maths",
  status: "submitted",
  assessmentProfile: {
    studyLevel: "A-level",
    qualificationOrModule: "A-level Mathematics",
    awardingBodyOrInstitution: "Example board",
    specificationOrCourse: "Mathematics",
  },
  questions: [
    { id: "q1", label: "Question 1", prompt: "Differentiate x²", marks: 4 },
    { id: "q2", label: "Question 2", prompt: "Integrate x", marks: 6 },
  ],
  markScheme: {
    kind: "official",
    items: [
      { questionId: "q1", answer: "2x", marking: "additive", criteria: [], acceptableAlternatives: [], commonMistakes: [] },
      { questionId: "q2", answer: "x²/2 + c", marking: "additive", criteria: [], acceptableAlternatives: [], commonMistakes: [] },
    ],
  },
});

const result: PracticePaperResult = {
  awardedMarks: 7,
  totalMarks: 10,
  percentage: 70,
  summary: "A sound attempt.",
  strengths: [],
  priorities: [],
  questionResults: [
    { questionId: "q1", label: "Question 1", awardedMarks: 3, maxMarks: 4, feedback: "", strengths: [], improvements: [], confidence: "high", counted: true, attempted: true },
    { questionId: "q2", label: "Question 2", awardedMarks: 4, maxMarks: 6, feedback: "", strengths: [], improvements: [], confidence: "low", counted: true, attempted: true },
  ],
};

const audit = {
  version: 1,
  primaryScores: { q1: 3, q2: 5 },
  verifierScores: { q1: 3, q2: 3 },
  disputedQuestionIds: ["q2"],
  adjudicatedQuestionIds: ["q2"],
  thirdViewQuestionIds: [],
  createdAt: 1,
};

describe("practice-paper mark calibration", () => {
  it("projects a content-free marking job without provider cost or evidence", () => {
    const projected = mapPracticePaperMarkingJobData("job-1", {
      paperId: "paper-1",
      attemptId: "attempt-1",
      status: "running",
      stage: "marking",
      estimatedCostUsd: 0.42,
      providerOutput: "private answer",
      evidenceManifest: { private: true },
    });
    expect(projected).toMatchObject({ paperId: "paper-1", status: "running", stage: "marking" });
    expect(projected).not.toHaveProperty("estimatedCostUsd");
    expect(projected).not.toHaveProperty("providerOutput");
    expect(projected).not.toHaveProperty("evidenceManifest");
  });

  it("keeps the rubric score exact and always adds an asymmetric overall range", () => {
    const calibrated = applyPracticePaperMarkRanges({ paper, result, audit });
    expect(calibrated.awardedMarks).toBe(7);
    expect(calibrated.markRange).toMatchObject({ lower: 5, upper: 8, earlyEstimate: false });
  });

  it("shows question ranges only for flagged decisions and includes marker bounds", () => {
    const calibrated = applyPracticePaperMarkRanges({ paper, result, audit });
    expect(calibrated.questionResults[0].markRange).toBeUndefined();
    expect(calibrated.questionResults[1].markRange).toMatchObject({ lower: 1, upper: 6 });
  });

  it("widens visible uncertainty for missing evidence without blocking a score", () => {
    const calibrated = applyPracticePaperMarkRanges({
      paper,
      result,
      audit: { ...audit, disputedQuestionIds: [], adjudicatedQuestionIds: [] },
      evidenceIssues: [{
        code: "answer_image_unreadable",
        severity: "warning",
        questionId: "q1",
        message: "Some handwriting was difficult to read.",
      }],
    });
    expect(calibrated.awardedMarks).toBe(7);
    expect(calibrated.questionResults[0].markRange?.reasons).toContain(
      "Some handwriting was difficult to read."
    );
    expect(calibrated.evidenceWarnings).toContain("Some handwriting was difficult to read.");
  });
});

/**
 * `measured: true` was a claim in a comment. Nothing computed the fractions it
 * described, nothing referenced them outside their own file, and every test
 * here checked behaviour rather than truth.
 *
 * These read the recorded marking runs and check the claim. They are the only
 * thing standing between a band that describes Jami and a band that used to.
 */
describe("what a calibration profile claims", () => {
  const REPORTS = "artifacts/evaluation";

  /** (jami - examiner) / tariff, over every question of every recorded run. */
  const recordedErrors = () => {
    if (!existsSync(REPORTS)) return [];
    const seen = new Map<string, number>();
    for (const file of readdirSync(REPORTS).filter((name) => name.endsWith(".json"))) {
      let parsed: { outcomes?: unknown };
      try {
        parsed = JSON.parse(readFileSync(`${REPORTS}/${file}`, "utf8"));
      } catch {
        continue;
      }
      const outcomes = parsed.outcomes;
      if (!Array.isArray(outcomes)) continue;
      for (const outcome of outcomes as {
        recordId?: string;
        candidate?: number;
        humanMarks?: number[];
        maxMarks?: number;
      }[]) {
        const human = outcome.humanMarks?.[0];
        if (
          !outcome.recordId ||
          typeof outcome.candidate !== "number" ||
          typeof human !== "number" ||
          !outcome.maxMarks
        ) {
          continue;
        }
        seen.set(`${file}:${outcome.recordId}`, (outcome.candidate - human) / outcome.maxMarks);
      }
    }
    return [...seen.values()];
  };

  /**
   * The band brackets the examiner's mark around Jami's, so it holds when the
   * signed error lies inside the band reflected. Getting that backwards once
   * made a sound band look like it covered half the cases.
   */
  const coverage = (errors: number[], lower: number, upper: number) =>
    errors.filter((value) => value >= -upper && value <= -lower).length / errors.length;

  it("covers most real questions where it says it was measured", () => {
    const errors = recordedErrors();
    if (errors.length < 50) {
      // Nothing recorded on this machine; the claim cannot be checked here.
      expect(true).toBe(true);
      return;
    }
    for (const profile of MARKING_CALIBRATION_PROFILES.filter((entry) => entry.measured)) {
      const covered = coverage(errors, profile.questionLowerFraction, profile.questionUpperFraction);
      expect(
        covered,
        `${profile.id} claims to be measured but covers ${(100 * covered).toFixed(1)}% of ${errors.length} recorded questions`
      ).toBeGreaterThan(0.7);
    }
  });

  /**
   * Jami marks generously, so the examiner's mark usually sits below Jami's and
   * the band has to reach further down than up. A symmetric band would be
   * centred on a number the evidence says is wrong.
   */
  it("leans the way the measured error leans", () => {
    for (const profile of MARKING_CALIBRATION_PROFILES.filter((entry) => entry.measured)) {
      expect(Math.abs(profile.questionLowerFraction)).toBeGreaterThan(profile.questionUpperFraction);
      expect(Math.abs(profile.paperLowerFraction)).toBeGreaterThan(profile.paperUpperFraction);
    }
  });

  /** One profile has evidence. The rest must not dress up as if they do. */
  it("keeps unmeasured profiles honestly marked", () => {
    const measured = MARKING_CALIBRATION_PROFILES.filter((entry) => entry.measured);
    expect(measured).toHaveLength(1);
    expect(measured[0].id).toBe("upper-secondary-quantitative");
  });
});

describe("a subject nobody has measured", () => {
  const unmeasuredPaper = mapPracticePaperData("paper-2", {
    notebookId: "paper-2",
    folderId: "folder-1",
    title: "Higher History",
    status: "submitted",
    assessmentProfile: {
      studyLevel: "Higher",
      qualificationOrModule: "Higher History",
      awardingBodyOrInstitution: "Example board",
      specificationOrCourse: "History",
    },
    questions: [{ id: "q1", label: "Question 1", prompt: "Discuss.", marks: 20 }],
    markScheme: {
      kind: "generated",
      items: [
        {
          questionId: "q1",
          marking: "banded",
          maxMarks: 20,
          answer: "A discussion.",
          bands: [{ id: "q1.L1", label: "Level 1", minMarks: 0, maxMarks: 20, descriptor: "..." }],
        },
      ],
    },
  });

  const result = {
    summary: "A report.",
    awardedMarks: 12,
    totalMarks: 20,
    percentage: 60,
    questionResults: [
      {
        questionId: "q1",
        label: "Question 1",
        awardedMarks: 12,
        maxMarks: 20,
        feedback: "Feedback.",
        evidence: ["a line"],
        strengths: [],
        improvements: [],
        confidence: "low" as const,
        counted: true,
        transcriptionNote: "Some writing was hard to read.",
      },
    ],
  } as unknown as PracticePaperResult;

  const marked = applyPracticePaperMarkRanges({
    paper: unmeasuredPaper,
    result,
    audit: {
      ...audit,
      primaryScores: { q1: 12 },
      verifierScores: { q1: 10 },
      disputedQuestionIds: [],
      adjudicatedQuestionIds: [],
    },
  });

  /** A range is a claim about measurement, and none was made here. */
  it("shows no range at all", () => {
    expect(marked.markRange).toBeUndefined();
    expect(marked.questionResults[0].markRange).toBeUndefined();
  });

  it("says why, rather than leaving the absence unexplained", () => {
    expect(marked.evidenceWarnings).toContain(UNCALIBRATED_NOTE);
  });

  /** The mark itself is rubric-derived and unaffected by any of this. */
  it("leaves the exact mark alone", () => {
    expect(marked.awardedMarks).toBe(12);
    expect(marked.questionResults[0].awardedMarks).toBe(12);
  });

  /**
   * An ambiguous answer is ambiguous whatever the subject, so the reasons
   * survive even though the numbers cannot.
   */
  it("keeps the reason the question was flagged", () => {
    expect(marked.questionResults[0].evidenceWarnings).toContain(
      "Some writing was hard to read."
    );
  });
});
