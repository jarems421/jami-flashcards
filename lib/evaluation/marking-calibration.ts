import type {
  PracticePaper,
  PracticePaperEvidenceIssue,
  PracticePaperMarkRange,
  PracticePaperMarkingAudit,
  PracticePaperResult,
} from "@/lib/practice/practice-papers";

export const MARKING_CALIBRATION_VERSION = "2026-08-21.v1";

export type CalibrationProfile = {
  id: string;
  subjects: string[];
  stages: string[];
  regimes: string[];
  questionLowerFraction: number;
  questionUpperFraction: number;
  paperLowerFraction: number;
  paperUpperFraction: number;
  measured: boolean;
};

// Content-free aggregates from the approved held-out reports. The first
// profile reflects the currently measured upper-secondary quantitative slice;
// every other branch deliberately receives a wider conservative interval.
/**
 * Exported so a test can check a profile's claim against recorded outcomes.
 *
 * `measured: true` was a claim in a comment. Nothing computed these fractions,
 * nothing referenced them outside this file, and the four tests covering this
 * module all checked behaviour -- that a range is asymmetric, that a flagged
 * question gets one -- and never whether a band matches what Jami does. They
 * happen to be about right: the measured question band covers 76.9% of 212
 * real questions and leans the correct way, wider downward because Jami marks
 * generously. The problem is that nothing connects them to the evidence, so
 * every accuracy change this month would have invalidated them silently.
 */
export const MARKING_CALIBRATION_PROFILES: CalibrationProfile[] = [
  {
    id: "upper-secondary-quantitative-subject-stage",
    subjects: ["maths", "physics", "chemistry", "statistics"],
    stages: ["upper_secondary"],
    regimes: ["*"],
    questionLowerFraction: -0.38,
    questionUpperFraction: 0.28,
    paperLowerFraction: -0.19,
    paperUpperFraction: 0.14,
    measured: false,
  },
  {
    id: "upper-secondary-regime",
    subjects: ["*"],
    stages: ["upper_secondary"],
    regimes: ["additive", "pointPool"],
    questionLowerFraction: -0.4,
    questionUpperFraction: 0.34,
    paperLowerFraction: -0.2,
    paperUpperFraction: 0.17,
    measured: false,
  },
  {
    id: "upper-secondary-quantitative",
    subjects: ["maths", "physics", "chemistry", "statistics"],
    stages: ["upper_secondary"],
    regimes: ["additive", "pointPool"],
    questionLowerFraction: -0.34,
    questionUpperFraction: 0.18,
    /**
     * The paper band is the number a student actually reads, and it is the one
     * nothing has measured. Every corpus record is one candidate answering one
     * question, so no whole paper exists to check it against.
     *
     * Simulating one from real question outcomes says it is mis-centred rather
     * than mis-sized. Jami's generosity is a bias, not noise, so it does not
     * average out across questions: a whole paper lands about 10% high with far
     * less spread than any single question. That makes the +8% upper edge cover
     * a case which barely happens -- an examiner marking a whole paper above
     * Jami -- while the lower edge stops short of the +22% errors that do.
     *
     * Same width, shifted down five points to -22% .. +3%, covers a great deal
     * more: 84.9% against 75.2% on a ten-question paper, 91.5% against 81.9% on
     * fifteen.
     *
     * Left alone deliberately. That is a simulation drawing questions
     * independently, and real marking errors correlate -- a marker generous on
     * one question tends to be generous on the next -- which would widen the
     * true spread rather than narrow it. Simulated evidence is not measured
     * evidence, and this profile claims to be measured. Changing a
     * student-facing number wants the real thing.
     */
    paperLowerFraction: -0.17,
    paperUpperFraction: 0.08,
    measured: true,
  },
  {
    id: "conservative-fallback",
    subjects: ["*"],
    stages: ["*"],
    regimes: ["*"],
    questionLowerFraction: -0.4,
    questionUpperFraction: 0.4,
    paperLowerFraction: -0.2,
    paperUpperFraction: 0.2,
    measured: false,
  },
];

function subjectOf(paper: PracticePaper) {
  const value = `${paper.assessmentProfile.qualificationOrModule} ${paper.assessmentProfile.specificationOrCourse}`.toLowerCase();
  if (/maths|mathematics/.test(value)) return "maths";
  for (const subject of [
    "maths", "physics", "chemistry", "statistics", "biology", "english",
    "history", "economics", "psychology", "french", "spanish", "german",
    "engineering", "computer science", "law", "sociology",
  ]) {
    if (value.includes(subject)) return subject.replace(" ", "");
  }
  return "unknown";
}

function stageOf(paper: PracticePaper) {
  const value = `${paper.assessmentProfile.studyLevel} ${paper.assessmentProfile.qualificationOrModule}`.toLowerCase();
  if (/university|undergraduate|degree|bsc|ba\b/.test(value)) return "undergraduate";
  if (/postgraduate|masters|msc|ma\b|phd/.test(value)) return "postgraduate";
  if (/gcse|a[- ]?level|higher|secondary|sixth form/.test(value)) return "upper_secondary";
  return "unknown";
}

function regimeOf(paper: PracticePaper) {
  const counts = new Map<string, number>();
  for (const item of paper.markScheme.items) {
    counts.set(item.marking, (counts.get(item.marking) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "unknown";
}

export function selectMarkingCalibrationProfile(paper: PracticePaper) {
  const subject = subjectOf(paper);
  const stage = stageOf(paper);
  const regime = regimeOf(paper);
  return MARKING_CALIBRATION_PROFILES
    .filter((profile) =>
      (profile.subjects.includes(subject) || profile.subjects.includes("*")) &&
      (profile.stages.includes(stage) || profile.stages.includes("*")) &&
      (profile.regimes.includes(regime) || profile.regimes.includes("*"))
    )
    .sort((left, right) => {
      const score = (profile: CalibrationProfile) =>
        (profile.subjects.includes("*") ? 0 : 4) +
        (profile.stages.includes("*") ? 0 : 2) +
        (profile.regimes.includes("*") ? 0 : 1);
      return score(right) - score(left);
    })[0] ?? MARKING_CALIBRATION_PROFILES[MARKING_CALIBRATION_PROFILES.length - 1];
}

function rangeAround(
  mark: number,
  maximum: number,
  lowerFraction: number,
  upperFraction: number
) {
  return {
    lower: Math.max(0, Math.min(maximum, mark + Math.floor(maximum * lowerFraction))),
    upper: Math.max(0, Math.min(maximum, mark + Math.ceil(maximum * upperFraction))),
  };
}

function issueMessages(
  issues: readonly PracticePaperEvidenceIssue[],
  questionId?: string
) {
  return Array.from(new Set(issues
    .filter((issue) => questionId === undefined || !issue.questionId || issue.questionId === questionId)
    .map((issue) => issue.message.trim())
    .filter(Boolean))).slice(0, 4);
}

/**
 * What a student is told where nothing has been measured for their subject.
 *
 * A range is a claim about measurement. Rendered in the same type, the same
 * place and the same words as a measured one, an invented band is
 * indistinguishable from evidence -- and only one of the five profiles here has
 * any behind it. So the unmeasured branches show the mark alone and say why,
 * rather than a wide interval and the word "estimate".
 */
export const UNCALIBRATED_NOTE =
  "Jami has not yet measured its own accuracy on this subject, so it is not showing a likely range.";

export function applyPracticePaperMarkRanges(input: {
  paper: PracticePaper;
  result: PracticePaperResult;
  audit: PracticePaperMarkingAudit;
  evidenceIssues?: readonly PracticePaperEvidenceIssue[];
  challengedQuestionIds?: readonly string[];
}) {
  const profile = selectMarkingCalibrationProfile(input.paper);
  const evidenceIssues = input.evidenceIssues ?? [];
  const challenged = new Set(input.challengedQuestionIds ?? []);
  const disputed = new Set(input.audit.disputedQuestionIds);
  const reviewed = new Set([
    ...input.audit.adjudicatedQuestionIds,
    ...input.audit.thirdViewQuestionIds,
  ]);

  const questionResults = input.result.questionResults.map((question) => {
    if (question.manualReason) {
      return { ...question, markRange: undefined, evidenceWarnings: [] };
    }
    const warnings = issueMessages(evidenceIssues, question.questionId);
    const isFlagged =
      disputed.has(question.questionId) ||
      reviewed.has(question.questionId) ||
      challenged.has(question.questionId) ||
      Boolean(question.transcriptionNote) ||
      warnings.length > 0;
    if (!isFlagged) return { ...question, evidenceWarnings: warnings };

    const base = rangeAround(
      question.awardedMarks,
      question.maxMarks,
      profile.questionLowerFraction,
      profile.questionUpperFraction
    );
    const primary = input.audit.primaryScores[question.questionId];
    const verifier = input.audit.verifierScores[question.questionId];
    const reasons = [...warnings];
    if (question.transcriptionNote) reasons.push(question.transcriptionNote);
    if (disputed.has(question.questionId) || reviewed.has(question.questionId)) {
      reasons.push("This answer allows more than one reasonable marking judgement.");
    }
    if (challenged.has(question.questionId)) {
      reasons.push("This answer was rechecked after your challenge.");
    }
    /**
     * The reasons are true whatever the subject -- an ambiguous answer is
     * ambiguous -- but the width of the band comes from the profile, so where
     * the profile is a guess the band is too. Keep the reasons, drop the
     * numbers.
     */
    if (!profile.measured) {
      return {
        ...question,
        evidenceWarnings: Array.from(new Set([...warnings, ...reasons])).slice(0, 6),
      };
    }
    const markRange: PracticePaperMarkRange = {
      lower: Math.max(0, Math.min(base.lower, primary ?? base.lower, verifier ?? base.lower)),
      upper: Math.min(question.maxMarks, Math.max(base.upper, primary ?? base.upper, verifier ?? base.upper)),
      calibrationVersion: MARKING_CALIBRATION_VERSION,
      earlyEstimate: false,
      reasons: Array.from(new Set(reasons)).slice(0, 6),
    };
    return { ...question, markRange, evidenceWarnings: warnings };
  });

  const overall = rangeAround(
    input.result.awardedMarks,
    input.result.totalMarks,
    profile.paperLowerFraction,
    profile.paperUpperFraction
  );
  const overallReasons = issueMessages(evidenceIssues);
  return {
    ...input.result,
    questionResults,
    ...(profile.measured
      ? {
          markRange: {
            ...overall,
            calibrationVersion: MARKING_CALIBRATION_VERSION,
            earlyEstimate: false,
            reasons: Array.from(new Set(overallReasons)).slice(0, 6),
          },
        }
      : { markRange: undefined }),
    evidenceWarnings: Array.from(
      new Set(profile.measured ? issueMessages(evidenceIssues) : [...issueMessages(evidenceIssues), UNCALIBRATED_NOTE])
    ).slice(0, 6),
    gradeEstimateKind: input.paper.gradeGuidance.kind === "official" ? "official" as const : "estimated" as const,
  };
}
