import type {
  PracticePaper,
  PracticePaperEvidenceIssue,
  PracticePaperMarkRange,
  PracticePaperMarkingAudit,
  PracticePaperResult,
} from "@/lib/practice/practice-papers";

export const MARKING_CALIBRATION_VERSION = "2026-08-21.v1";

type CalibrationProfile = {
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
const PROFILES: CalibrationProfile[] = [
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
  return PROFILES
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
    })[0] ?? PROFILES[PROFILES.length - 1];
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
    const markRange: PracticePaperMarkRange = {
      lower: Math.max(0, Math.min(base.lower, primary ?? base.lower, verifier ?? base.lower)),
      upper: Math.min(question.maxMarks, Math.max(base.upper, primary ?? base.upper, verifier ?? base.upper)),
      calibrationVersion: MARKING_CALIBRATION_VERSION,
      earlyEstimate: !profile.measured,
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
  if (!profile.measured) {
    overallReasons.push("This is an early estimate based on comparable marking evidence.");
  }
  return {
    ...input.result,
    questionResults,
    markRange: {
      ...overall,
      calibrationVersion: MARKING_CALIBRATION_VERSION,
      earlyEstimate: !profile.measured,
      reasons: Array.from(new Set(overallReasons)).slice(0, 6),
    },
    gradeEstimateKind: input.paper.gradeGuidance.kind === "official" ? "official" as const : "estimated" as const,
    evidenceWarnings: issueMessages(evidenceIssues),
  };
}
