import {
  normalizeOptionalString,
  normalizeStringArray,
} from "@/lib/material/content";
import {
  normalizeMarkSchemeItem,
  type PracticePaperMarkSchemeItem,
} from "@/lib/practice/mark-schemes";

export const MAX_PRACTICE_PAPER_SOURCE_IDS = 15;
export const MAX_PRACTICE_PAPER_QUESTIONS = 30;

export type PracticePaperOrigin = "generated" | "uploaded";
export type PracticePaperStatus =
  | "setup"
  | "ready"
  | "in_progress"
  | "submitted"
  | "marked";
export type PracticePaperLength = "full";
export type PracticePaperFocus = "balanced" | "weak_areas" | "custom";
export type PracticePaperTimingMode = "timed" | "untimed";
export type PracticePaperTimingState =
  | "not_started"
  | "running"
  | "paused"
  | "awaiting_overtime"
  | "overtime"
  | "submitted";
export type PracticePaperConfidence = "low" | "medium" | "high";
export type PracticePaperMarkSchemeKind =
  | "generated"
  | "official"
  | "estimated"
  | "missing";
export type PracticePaperAssetType =
  | "table"
  | "graph"
  | "diagram"
  | "formula_sheet"
  | "source_extract"
  | "image"
  | "illustration";

export type PracticePaperAssetSource =
  | "deterministic"
  | "generated"
  | "uploaded";
export type PracticePaperAssetValidationStatus =
  | "pending"
  | "valid"
  | "invalid";

export type PracticePaperQuestionAsset = {
  id: string;
  type: PracticePaperAssetType;
  title: string;
  content: string;
  altText: string;
  caption?: string;
  storagePath?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  source?: PracticePaperAssetSource;
  validationStatus?: PracticePaperAssetValidationStatus;
};

export type PracticePaperJobStatus =
  | "queued"
  | "running"
  | "needs_clarification"
  | "ready"
  | "failed"
  | "cancelled";

export type PracticePaperJobStage =
  | "queued"
  | "reading_sources"
  | "researching"
  | "designing"
  | "building_mark_scheme"
  | "auditing"
  | "creating_figures"
  | "final_checks"
  | "ready";

export type PracticePaperJob = {
  id: string;
  paperId: string;
  folderId: string;
  status: PracticePaperJobStatus;
  stage: PracticePaperJobStage;
  progress: number;
  title: string;
  clarificationQuestion?: string;
  failureCode?: string;
  failureMessage?: string;
  workflowRunId?: string;
  cancellationRequested: boolean;
  readyUnread: boolean;
  retryCount: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
};

export type PracticePaperAssessmentProfile = {
  studyLevel: string;
  qualificationOrModule: string;
  awardingBodyOrInstitution: string;
  specificationOrCourse: string;
  tierOrComponent: string;
  formatSummary: string;
  confidence: PracticePaperConfidence;
};

export type PracticePaperQuestion = {
  id: string;
  label: string;
  prompt: string;
  marks: number;
  assets: PracticePaperQuestionAsset[];
};

export type PracticePaperChoiceGroup = {
  id: string;
  label: string;
  requiredCount: number;
  questionIds: string[];
  selectionRule: "highest_scoring" | "first_answered";
};

export type PracticePaperGradeGuidance = {
  kind: "official" | "estimated" | "none";
  label: string;
  notice: string;
  boundaries: Array<{ label: string; minimumPercentage: number }>;
  latestComparable?: {
    label: string;
    year: string;
    boundaries: Array<{ label: string; minimumPercentage: number }>;
  };
  historicalMedian?: {
    label: string;
    years: string;
    boundaries: Array<{ label: string; minimumPercentage: number }>;
  };
};

export type {
  PracticePaperMarkSchemeItem,
  PracticePaperMarkingModel,
  PracticePaperMarkPoint,
  PracticePaperMarkBand,
  PracticePaperMarkTrait,
  PracticePaperCompetency,
  PracticePaperExpectedValue,
} from "@/lib/practice/mark-schemes";

export type PracticePaperMarkScheme = {
  kind: PracticePaperMarkSchemeKind;
  label: string;
  notice: string;
  items: PracticePaperMarkSchemeItem[];
};

export type PracticePaperCriterionResult = {
  criterion: string;
  awarded: boolean;
  evidence: string;
};

export type PracticePaperQuestionResult = {
  questionId: string;
  label: string;
  awardedMarks: number;
  maxMarks: number;
  feedback: string;
  criterionResults?: PracticePaperCriterionResult[];
  evidence?: string[];
  correction?: string;
  nextStep?: string;
  modelAnswer?: string;
  strengths: string[];
  improvements: string[];
  confidence: PracticePaperConfidence;
  transcriptionNote?: string;
  counted: boolean;
  manualReason?: string;
  attempted: boolean;
};

export type PracticePaperMarkingAudit = {
  version: number;
  primaryScores: Record<string, number>;
  verifierScores: Record<string, number>;
  disputedQuestionIds: string[];
  adjudicatedQuestionIds: string[];
  thirdViewQuestionIds: string[];
  createdAt: number;
};

export type PracticePaperGenerationAudit = {
  issueCount: number;
  repaired: boolean;
  createdAt: number;
};

export type PracticePaperResearchCitation = {
  title: string;
  url: string;
  authority: "official" | "primary" | "credible";
  role: "specification" | "format" | "guidance" | "background";
};

export type PracticePaperResearchReceipt = {
  used: boolean;
  summary: string;
  confidence: PracticePaperConfidence;
  citations: PracticePaperResearchCitation[];
};

export type PracticePaperRemarkAudit = {
  questionId: string;
  reason: string;
  previousMarks: number;
  revisedMarks: number;
  markingAudit: PracticePaperMarkingAudit;
  createdAt: number;
};

export type PracticePaperResult = {
  awardedMarks: number;
  totalMarks: number;
  percentage: number;
  summary: string;
  strengths: string[];
  priorities: string[];
  questionResults: PracticePaperQuestionResult[];
  gradeLabel?: string;
};

export type PracticePaperAttempt = {
  id: string;
  paperId: string;
  notebookId: string;
  paperTitle: string;
  attemptNumber: number;
  status: "in_progress" | "submitted" | "marked";
  startedAt: number;
  timingMode: PracticePaperTimingMode;
  timingState: PracticePaperTimingState;
  durationMinutes: number;
  deadlineAt?: number;
  pausedAt?: number;
  totalPausedMs: number;
  overtimeStartedAt?: number;
  deadlineSnapshotAt?: number;
  deadlineVersion: number;
  tutorEnabled: boolean;
  tutorUsed: boolean;
  assisted: boolean;
  submittedAt?: number;
  markedAt?: number;
  result?: PracticePaperResult;
  withinTimeResult?: PracticePaperResult;
  overtimeMarksGained?: number;
  markingAudit?: PracticePaperMarkingAudit;
  withinTimeMarkingAudit?: PracticePaperMarkingAudit;
  remarkAudits?: PracticePaperRemarkAudit[];
  createdAt: number;
  updatedAt: number;
};

export type PracticePaper = {
  id: string;
  notebookId: string;
  folderId: string;
  title: string;
  origin: PracticePaperOrigin;
  status: PracticePaperStatus;
  sourceIds: string[];
  sourceLabels: string[];
  request: string;
  coverage: string;
  length: PracticePaperLength;
  focus: PracticePaperFocus;
  focusDetail?: string;
  durationMinutes: number;
  timingMode: PracticePaperTimingMode;
  timingState: PracticePaperTimingState;
  deadlineAt?: number;
  pausedAt?: number;
  totalPausedMs: number;
  overtimeStartedAt?: number;
  deadlineSnapshotAt?: number;
  deadlineVersion: number;
  tutorEnabled: boolean;
  tutorUsed: boolean;
  timerEnabled: boolean;
  instructions: string[];
  assessmentProfile: PracticePaperAssessmentProfile;
  questions: PracticePaperQuestion[];
  choiceGroups: PracticePaperChoiceGroup[];
  totalMarks: number;
  markScheme: PracticePaperMarkScheme;
  markSchemeSourceId?: string;
  preparedAt?: number;
  startedAt?: number;
  submittedAt?: number;
  markedAt?: number;
  result?: PracticePaperResult;
  withinTimeResult?: PracticePaperResult;
  overtimeMarksGained?: number;
  markingAudit?: PracticePaperMarkingAudit;
  withinTimeMarkingAudit?: PracticePaperMarkingAudit;
  remarkAudits?: PracticePaperRemarkAudit[];
  generationAudit?: PracticePaperGenerationAudit;
  researchReceipt?: PracticePaperResearchReceipt;
  gradeGuidance: PracticePaperGradeGuidance;
  examinerInsights: string[];
  activeAttemptId?: string;
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
};

export type GeneratedPracticePaper = {
  assessmentProfile: PracticePaperAssessmentProfile;
  title: string;
  instructions: string[];
  durationMinutes: number;
  questions: PracticePaperQuestion[];
  choiceGroups: PracticePaperChoiceGroup[];
  totalMarks: number;
  markScheme: PracticePaperMarkScheme;
  sourceIds: string[];
  sourceLabels: string[];
  gradeGuidance: PracticePaperGradeGuidance;
  examinerInsights: string[];
  generationAudit?: PracticePaperGenerationAudit;
  researchReceipt?: PracticePaperResearchReceipt;
};

export type PracticePaperGenerationResponse =
  | {
      status: "needs_clarification";
      question: string;
      sourceIds: string[];
      sourceLabels: string[];
    }
  | ({ status: "ready" } & GeneratedPracticePaper);

function finiteInteger(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

function normalizeTextList(value: unknown, maximum: number, maxLength = 800) {
  return normalizeStringArray(value, maximum, maxLength);
}

function isConfidence(value: unknown): value is PracticePaperConfidence {
  return value === "low" || value === "medium" || value === "high";
}

function isStatus(value: unknown): value is PracticePaperStatus {
  return (
    value === "setup" ||
    value === "ready" ||
    value === "in_progress" ||
    value === "submitted" ||
    value === "marked"
  );
}

function isLength(value: unknown): value is PracticePaperLength {
  return value === "full";
}

function isTimingMode(value: unknown): value is PracticePaperTimingMode {
  return value === "timed" || value === "untimed";
}

function isTimingState(value: unknown): value is PracticePaperTimingState {
  return (
    value === "not_started" ||
    value === "running" ||
    value === "paused" ||
    value === "awaiting_overtime" ||
    value === "overtime" ||
    value === "submitted"
  );
}

function isFocus(value: unknown): value is PracticePaperFocus {
  return value === "balanced" || value === "weak_areas" || value === "custom";
}

function isMarkSchemeKind(value: unknown): value is PracticePaperMarkSchemeKind {
  return (
    value === "generated" ||
    value === "official" ||
    value === "estimated" ||
    value === "missing"
  );
}

function isAssetType(value: unknown): value is PracticePaperAssetType {
  return (
    value === "table" ||
    value === "graph" ||
    value === "diagram" ||
    value === "formula_sheet" ||
    value === "source_extract" ||
    value === "image" ||
    value === "illustration"
  );
}

function isAssetSource(value: unknown): value is PracticePaperAssetSource {
  return value === "deterministic" || value === "generated" || value === "uploaded";
}

function isAssetValidationStatus(
  value: unknown
): value is PracticePaperAssetValidationStatus {
  return value === "pending" || value === "valid" || value === "invalid";
}

export function normalizeQuestionAssets(value: unknown): PracticePaperQuestionAsset[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  return value.slice(0, 8).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const asset = candidate as Record<string, unknown>;
    if (!isAssetType(asset.type)) return [];
    const content = normalizeOptionalString(asset.content, 6_000) ?? "";
    const storagePath = normalizeOptionalString(asset.storagePath, 1_000);
    if (!content && !storagePath) return [];
    const requestedId = normalizeOptionalString(asset.id, 80)
      ?.replace(/[^A-Za-z0-9_-]/g, "-")
      .replace(/^-+|-+$/g, "") || `asset-${index + 1}`;
    let id = requestedId;
    for (let suffix = 2; seenIds.has(id); suffix += 1) {
      id = `${requestedId.slice(0, 70)}-${suffix}`;
    }
    seenIds.add(id);
    return [{
      id,
      type: asset.type,
      title: normalizeOptionalString(asset.title, 160) ?? "Supporting material",
      content,
      altText: normalizeOptionalString(asset.altText, 500) ?? "",
      caption: normalizeOptionalString(asset.caption, 500),
      storagePath,
      mimeType: normalizeOptionalString(asset.mimeType, 120),
      width: finiteInteger(asset.width) || undefined,
      height: finiteInteger(asset.height) || undefined,
      source: isAssetSource(asset.source) ? asset.source : undefined,
      validationStatus: isAssetValidationStatus(asset.validationStatus)
        ? asset.validationStatus
        : undefined,
    }];
  });
}

function isPracticePaperJobStatus(value: unknown): value is PracticePaperJobStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "needs_clarification" ||
    value === "ready" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isPracticePaperJobStage(value: unknown): value is PracticePaperJobStage {
  return (
    value === "queued" ||
    value === "reading_sources" ||
    value === "researching" ||
    value === "designing" ||
    value === "building_mark_scheme" ||
    value === "auditing" ||
    value === "creating_figures" ||
    value === "final_checks" ||
    value === "ready"
  );
}

export function mapPracticePaperJobData(
  id: string,
  data: Record<string, unknown>
): PracticePaperJob {
  return {
    id,
    paperId: normalizeOptionalString(data.paperId, 160) ?? "",
    folderId: normalizeOptionalString(data.folderId, 160) ?? "",
    status: isPracticePaperJobStatus(data.status) ? data.status : "queued",
    stage: isPracticePaperJobStage(data.stage) ? data.stage : "queued",
    progress: Math.min(100, finiteInteger(data.progress)),
    title: normalizeOptionalString(data.title, 160) ?? "Practice paper",
    clarificationQuestion: normalizeOptionalString(data.clarificationQuestion, 600),
    failureCode: normalizeOptionalString(data.failureCode, 120),
    failureMessage: normalizeOptionalString(data.failureMessage, 500),
    workflowRunId: normalizeOptionalString(data.workflowRunId, 200),
    cancellationRequested: data.cancellationRequested === true,
    readyUnread: data.readyUnread === true,
    retryCount: finiteInteger(data.retryCount),
    createdAt: finiteInteger(data.createdAt),
    startedAt: finiteInteger(data.startedAt) || undefined,
    completedAt: finiteInteger(data.completedAt) || undefined,
    updatedAt: finiteInteger(data.updatedAt),
  };
}

export function normalizePracticePaperAssessmentProfile(
  value: unknown
): PracticePaperAssessmentProfile {
  const profile = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  return {
    studyLevel: normalizeOptionalString(profile.studyLevel, 160) ?? "Not confirmed",
    qualificationOrModule:
      normalizeOptionalString(profile.qualificationOrModule, 200) ?? "Not confirmed",
    awardingBodyOrInstitution:
      normalizeOptionalString(profile.awardingBodyOrInstitution, 200) ?? "",
    specificationOrCourse:
      normalizeOptionalString(profile.specificationOrCourse, 240) ?? "",
    tierOrComponent: normalizeOptionalString(profile.tierOrComponent, 160) ?? "",
    formatSummary: normalizeOptionalString(profile.formatSummary, 1_200) ?? "",
    confidence: isConfidence(profile.confidence) ? profile.confidence : "low",
  };
}

export function normalizePracticePaperQuestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  const questions: PracticePaperQuestion[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, MAX_PRACTICE_PAPER_QUESTIONS)) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const id = normalizeOptionalString(item.id, 80) ?? "";
    const prompt = normalizeOptionalString(item.prompt, 4_000) ?? "";
    if (!id || !prompt || seen.has(id)) continue;
    seen.add(id);
    questions.push({
      id,
      label: normalizeOptionalString(item.label, 80) ?? `Question ${questions.length + 1}`,
      prompt,
      marks: Math.max(1, finiteInteger(item.marks, 1)),
      assets: normalizeQuestionAssets(item.assets),
    });
  }
  return questions;
}

export function normalizePracticePaperChoiceGroups(
  value: unknown,
  questions: readonly PracticePaperQuestion[]
): PracticePaperChoiceGroup[] {
  if (!Array.isArray(value)) return [];
  const validQuestionIds = new Set(questions.map((question) => question.id));
  const claimed = new Set<string>();
  return value.slice(0, 10).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const group = candidate as Record<string, unknown>;
    const questionIds = normalizeStringArray(group.questionIds, 20, 80).filter(
      (questionId) => validQuestionIds.has(questionId) && !claimed.has(questionId)
    );
    if (questionIds.length < 2) return [];
    questionIds.forEach((questionId) => claimed.add(questionId));
    return [{
      id: normalizeOptionalString(group.id, 80) ?? `choice-${index + 1}`,
      label: normalizeOptionalString(group.label, 200) ?? "Optional questions",
      requiredCount: Math.max(
        1,
        Math.min(questionIds.length, finiteInteger(group.requiredCount, 1))
      ),
      questionIds,
      selectionRule:
        group.selectionRule === "first_answered" ? "first_answered" : "highest_scoring",
    }];
  });
}

export function calculatePracticePaperTotalMarks(
  questions: readonly PracticePaperQuestion[],
  choiceGroups: readonly PracticePaperChoiceGroup[]
) {
  const grouped = new Set(choiceGroups.flatMap((group) => group.questionIds));
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const requiredChoiceMarks = choiceGroups.reduce((total, group) => {
    const marks = group.questionIds
      .map((questionId) => questionById.get(questionId)?.marks ?? 0)
      .sort((left, right) => right - left)
      .slice(0, group.requiredCount);
    return total + marks.reduce((sum, mark) => sum + mark, 0);
  }, 0);
  return questions.reduce(
    (total, question) => total + (grouped.has(question.id) ? 0 : question.marks),
    requiredChoiceMarks
  );
}

export function normalizePracticePaperGradeGuidance(
  value: unknown
): PracticePaperGradeGuidance {
  const guidance = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  const normalizeBoundaries = (value: unknown) => Array.isArray(value)
    ? value.slice(0, 20).flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const boundary = candidate as Record<string, unknown>;
        const label = normalizeOptionalString(boundary.label, 80) ?? "";
        if (!label) return [];
        return [{
          label,
          minimumPercentage: Math.max(
            0,
            Math.min(100, finiteInteger(boundary.minimumPercentage))
          ),
        }];
      })
    : [];
  const boundaries = normalizeBoundaries(guidance.boundaries);
  const latest = guidance.latestComparable &&
    typeof guidance.latestComparable === "object"
      ? guidance.latestComparable as Record<string, unknown>
      : null;
  const historical = guidance.historicalMedian &&
    typeof guidance.historicalMedian === "object"
      ? guidance.historicalMedian as Record<string, unknown>
      : null;
  const latestBoundaries = normalizeBoundaries(latest?.boundaries);
  const historicalBoundaries = normalizeBoundaries(historical?.boundaries);
  const primaryBoundaries = boundaries.length > 0 ? boundaries : latestBoundaries;
  const kind = guidance.kind === "official" || guidance.kind === "estimated"
    ? guidance.kind
    : "none";
  return {
    kind: primaryBoundaries.length > 0 ? kind : "none",
    label: normalizeOptionalString(guidance.label, 160) ?? "No grade guidance",
    notice: normalizeOptionalString(guidance.notice, 500) ?? "",
    boundaries: primaryBoundaries.sort(
      (left, right) => right.minimumPercentage - left.minimumPercentage
    ),
    ...(latest && latestBoundaries.length > 0
      ? {
          latestComparable: {
            label:
              normalizeOptionalString(latest.label, 160) ??
              "Latest comparable boundary",
            year: normalizeOptionalString(latest.year, 40) ?? "",
            boundaries: latestBoundaries.sort(
              (left, right) => right.minimumPercentage - left.minimumPercentage
            ),
          },
        }
      : {}),
    ...(historical && historicalBoundaries.length > 0
      ? {
          historicalMedian: {
            label:
              normalizeOptionalString(historical.label, 160) ??
              "Historical median",
            years: normalizeOptionalString(historical.years, 80) ?? "",
            boundaries: historicalBoundaries.sort(
              (left, right) => right.minimumPercentage - left.minimumPercentage
            ),
          },
        }
      : {}),
  };
}

/**
 * A whole-number percentage, always rounded down.
 *
 * Two reasons it is not `Math.round`. A tenth of a percent implies a precision
 * this marking does not have, and rounding up walks a student across a grade
 * boundary they did not reach: 69.6% is not a Grade 7, and no board would give
 * it. `getPracticePaperGradeLabel` compares against this value, so flooring
 * here is what keeps the boundary honest.
 */
export function calculatePracticePaperPercentage(
  awardedMarks: number,
  totalMarks: number
) {
  return totalMarks > 0
    ? Math.max(0, Math.floor((awardedMarks / totalMarks) * 100))
    : 0;
}

export function getPracticePaperGradeLabel(
  percentage: number,
  guidance: PracticePaperGradeGuidance
) {
  return guidance.boundaries.find(
    (boundary) => percentage >= boundary.minimumPercentage
  )?.label;
}

export function applyPracticePaperMarkCorrection(
  result: PracticePaperResult,
  questionId: string,
  awardedMarks: number,
  reason: string,
  guidance: PracticePaperGradeGuidance
): PracticePaperResult {
  const questionResults = result.questionResults.map((question) =>
    question.questionId === questionId
      ? {
          ...question,
          awardedMarks: Math.max(0, Math.min(question.maxMarks, Math.round(awardedMarks))),
          manualReason: reason.trim().slice(0, 500) || "Reviewed manually",
        }
      : question
  );
  const awarded = questionResults.reduce(
    (total, question) => total + (question.counted ? question.awardedMarks : 0),
    0
  );
  const percentage = calculatePracticePaperPercentage(awarded, result.totalMarks);
  return {
    ...result,
    questionResults,
    awardedMarks: awarded,
    percentage,
    gradeLabel: getPracticePaperGradeLabel(percentage, guidance),
  };
}

export function normalizePracticePaperMarkScheme(
  value: unknown,
  questions: readonly PracticePaperQuestion[]
): PracticePaperMarkScheme {
  const scheme = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const items: PracticePaperMarkSchemeItem[] = [];
  const seen = new Set<string>();
  if (Array.isArray(scheme.items)) {
    for (const candidate of scheme.items.slice(0, MAX_PRACTICE_PAPER_QUESTIONS)) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as Record<string, unknown>;
      const questionId = normalizeOptionalString(item.questionId, 80) ?? "";
      const question = questionById.get(questionId);
      if (!question || seen.has(questionId)) continue;
      // An unreadable item is dropped rather than coerced, which shortens the
      // list, which fails the count check in the quality gate, which fires the
      // existing repair pass. Guessing a shape here would launder bad model
      // output into a stored paper.
      const parsed = normalizeMarkSchemeItem(item, question);
      if (!parsed) continue;
      seen.add(questionId);
      items.push(parsed);
    }
  }
  return {
    kind: isMarkSchemeKind(scheme.kind) ? scheme.kind : "generated",
    label: normalizeOptionalString(scheme.label, 160) ?? "Jami-generated marking guide",
    notice:
      normalizeOptionalString(scheme.notice, 500) ??
      "This marking guide was generated by Jami and is not an official mark scheme.",
    items,
  };
}

function normalizeQuestionResults(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_PRACTICE_PAPER_QUESTIONS)
    .flatMap((candidate): PracticePaperQuestionResult[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      const questionId = normalizeOptionalString(item.questionId, 80) ?? "";
      if (!questionId) return [];
      const maxMarks = Math.max(0, finiteInteger(item.maxMarks));
      const criterionResults = Array.isArray(item.criterionResults)
        ? item.criterionResults.slice(0, 40).flatMap((candidate) => {
            if (!candidate || typeof candidate !== "object") return [];
            const criterion = candidate as Record<string, unknown>;
            const label = normalizeOptionalString(criterion.criterion, 800) ?? "";
            if (!label) return [];
            return [{
              criterion: label,
              awarded: criterion.awarded === true,
              evidence: normalizeOptionalString(criterion.evidence, 1_000) ?? "",
            }];
          })
        : [];
      return [{
        questionId,
        label: normalizeOptionalString(item.label, 80) ?? questionId,
        awardedMarks: Math.min(maxMarks, finiteInteger(item.awardedMarks)),
        maxMarks,
        feedback: normalizeOptionalString(item.feedback, 2_000) ?? "",
        criterionResults,
        evidence: normalizeTextList(item.evidence, 12, 1_000),
        correction: normalizeOptionalString(item.correction, 2_000) ?? "",
        nextStep: normalizeOptionalString(item.nextStep, 1_000) ?? "",
        modelAnswer: normalizeOptionalString(item.modelAnswer, 4_000) ?? "",
        strengths: normalizeTextList(item.strengths, 8),
        improvements: normalizeTextList(item.improvements, 8),
        confidence: isConfidence(item.confidence) ? item.confidence : "medium",
        transcriptionNote: normalizeOptionalString(item.transcriptionNote, 500),
        counted: item.counted !== false,
        manualReason: normalizeOptionalString(item.manualReason, 500),
        attempted: item.attempted === true || finiteInteger(item.awardedMarks) > 0,
      }];
    });
}

export function normalizePracticePaperResult(value: unknown): PracticePaperResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  const questionResults = normalizeQuestionResults(result.questionResults);
  const declaredTotalMarks = finiteInteger(result.totalMarks);
  const totalMarks = declaredTotalMarks > 0
    ? declaredTotalMarks
    : questionResults.reduce((total, item) => total + item.maxMarks, 0);
  const awardedMarks = Math.min(
    totalMarks,
    finiteInteger(
      result.awardedMarks,
      questionResults.reduce((total, item) => total + item.awardedMarks, 0)
    )
  );
  return {
    awardedMarks,
    totalMarks,
    percentage: calculatePracticePaperPercentage(awardedMarks, totalMarks),
    summary: normalizeOptionalString(result.summary, 2_000) ?? "",
    strengths: normalizeTextList(result.strengths, 10),
    priorities: normalizeTextList(result.priorities, 10),
    questionResults,
    gradeLabel: normalizeOptionalString(result.gradeLabel, 80),
  };
}

export function normalizePracticePaperMarkingAudit(
  value: unknown
): PracticePaperMarkingAudit | undefined {
  if (!value || typeof value !== "object") return undefined;
  const audit = value as Record<string, unknown>;
  const normalizeScores = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") return {};
    return Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .filter((entry): entry is [string, number] =>
          Boolean(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1])
        )
        .slice(0, MAX_PRACTICE_PAPER_QUESTIONS)
        .map(([key, score]) => [key.slice(0, 80), Math.max(0, Math.round(score))])
    );
  };
  return {
    version: Math.max(1, finiteInteger(audit.version, 1)),
    primaryScores: normalizeScores(audit.primaryScores),
    verifierScores: normalizeScores(audit.verifierScores),
    disputedQuestionIds: normalizeStringArray(
      audit.disputedQuestionIds,
      MAX_PRACTICE_PAPER_QUESTIONS,
      80
    ),
    adjudicatedQuestionIds: normalizeStringArray(
      audit.adjudicatedQuestionIds,
      MAX_PRACTICE_PAPER_QUESTIONS,
      80
    ),
    thirdViewQuestionIds: normalizeStringArray(
      audit.thirdViewQuestionIds,
      MAX_PRACTICE_PAPER_QUESTIONS,
      80
    ),
    createdAt: finiteInteger(audit.createdAt),
  };
}

function normalizePracticePaperGenerationAudit(
  value: unknown
): PracticePaperGenerationAudit | undefined {
  if (!value || typeof value !== "object") return undefined;
  const audit = value as Record<string, unknown>;
  return {
    issueCount: finiteInteger(audit.issueCount),
    repaired: audit.repaired === true,
    createdAt: finiteInteger(audit.createdAt),
  };
}

/**
 * Practice-paper documents are readable by the student while they sit the
 * paper, so they may contain rubric metadata but never the answer-bearing
 * items. The complete guide belongs in the server-only
 * `practicePaperSecrets` collection.
 */
export function toPublicPracticePaperMarkScheme(
  value: PracticePaperMarkScheme
): PracticePaperMarkScheme {
  return {
    kind: value.kind,
    label: value.label.trim().slice(0, 160),
    notice: value.notice.trim().slice(0, 500),
    items: [],
  };
}

export function normalizePracticePaperResearchReceipt(
  value: unknown
): PracticePaperResearchReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const receipt = value as Record<string, unknown>;
  const citations = Array.isArray(receipt.citations)
    ? receipt.citations.slice(0, 20).flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const citation = candidate as Record<string, unknown>;
        const title = normalizeOptionalString(citation.title, 240) ?? "";
        const url = normalizeOptionalString(citation.url, 2_000) ?? "";
        if (!title || !/^https?:\/\//i.test(url)) return [];
        const authority: PracticePaperResearchCitation["authority"] =
          citation.authority === "official" || citation.authority === "primary"
            ? citation.authority
            : "credible";
        const role: PracticePaperResearchCitation["role"] =
          citation.role === "specification" ||
          citation.role === "format" ||
          citation.role === "guidance"
            ? citation.role
            : "background";
        return [{
          title,
          url,
          authority,
          role,
        }];
      })
    : [];
  return {
    used: receipt.used === true && citations.length > 0,
    summary: normalizeOptionalString(receipt.summary, 500) ?? "",
    confidence: isConfidence(receipt.confidence) ? receipt.confidence : "low",
    citations,
  };
}

function normalizePracticePaperRemarkAudits(
  value: unknown
): PracticePaperRemarkAudit[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-30).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const audit = candidate as Record<string, unknown>;
    const questionId = normalizeOptionalString(audit.questionId, 80) ?? "";
    const markingAudit = normalizePracticePaperMarkingAudit(audit.markingAudit);
    if (!questionId || !markingAudit) return [];
    return [{
      questionId,
      reason: normalizeOptionalString(audit.reason, 500) ?? "AI recheck",
      previousMarks: finiteInteger(audit.previousMarks),
      revisedMarks: finiteInteger(audit.revisedMarks),
      markingAudit,
      createdAt: finiteInteger(audit.createdAt),
    }];
  });
}

export function mapPracticePaperAttemptData(
  id: string,
  data: Record<string, unknown>
): PracticePaperAttempt {
  const status = data.status === "submitted" || data.status === "marked"
    ? data.status
    : "in_progress";
  return {
    id,
    paperId: normalizeOptionalString(data.paperId, 160) ?? "",
    notebookId: normalizeOptionalString(data.notebookId, 160) ?? "",
    paperTitle: normalizeOptionalString(data.paperTitle, 160) ?? "Practice paper",
    attemptNumber: Math.max(1, finiteInteger(data.attemptNumber, 1)),
    status,
    startedAt: finiteInteger(data.startedAt),
    timingMode: isTimingMode(data.timingMode)
      ? data.timingMode
      : data.timerEnabled === true
        ? "timed"
        : "untimed",
    timingState: isTimingState(data.timingState)
      ? data.timingState
      : status === "in_progress"
        ? "running"
        : "submitted",
    durationMinutes: finiteInteger(data.durationMinutes),
    deadlineAt: finiteInteger(data.deadlineAt) || undefined,
    pausedAt: finiteInteger(data.pausedAt) || undefined,
    totalPausedMs: finiteInteger(data.totalPausedMs),
    overtimeStartedAt: finiteInteger(data.overtimeStartedAt) || undefined,
    deadlineSnapshotAt: finiteInteger(data.deadlineSnapshotAt) || undefined,
    deadlineVersion: finiteInteger(data.deadlineVersion),
    tutorEnabled: data.tutorEnabled === true,
    tutorUsed: data.tutorUsed === true,
    assisted: data.assisted === true || data.tutorEnabled === true,
    submittedAt: finiteInteger(data.submittedAt) || undefined,
    markedAt: finiteInteger(data.markedAt) || undefined,
    result: normalizePracticePaperResult(data.result),
    withinTimeResult: normalizePracticePaperResult(data.withinTimeResult),
    overtimeMarksGained: finiteInteger(data.overtimeMarksGained) || undefined,
    markingAudit: normalizePracticePaperMarkingAudit(data.markingAudit),
    withinTimeMarkingAudit: normalizePracticePaperMarkingAudit(
      data.withinTimeMarkingAudit
    ),
    remarkAudits: normalizePracticePaperRemarkAudits(data.remarkAudits),
    createdAt: finiteInteger(data.createdAt),
    updatedAt: finiteInteger(data.updatedAt),
  };
}

export function mapPracticePaperData(
  id: string,
  data: Record<string, unknown>
): PracticePaper {
  const questions = normalizePracticePaperQuestions(data.questions);
  const choiceGroups = normalizePracticePaperChoiceGroups(data.choiceGroups, questions);
  const totalMarks = calculatePracticePaperTotalMarks(questions, choiceGroups);
  return {
    id,
    notebookId: normalizeOptionalString(data.notebookId, 160) ?? id,
    folderId: normalizeOptionalString(data.folderId, 160) ?? "",
    title: normalizeOptionalString(data.title, 160) ?? "Practice paper",
    origin: data.origin === "uploaded" ? "uploaded" : "generated",
    status: isStatus(data.status) ? data.status : "setup",
    sourceIds: normalizeStringArray(
      data.sourceIds,
      MAX_PRACTICE_PAPER_SOURCE_IDS,
      160
    ),
    sourceLabels: normalizeTextList(data.sourceLabels, MAX_PRACTICE_PAPER_SOURCE_IDS, 160),
    request: normalizeOptionalString(data.request, 2_000) ?? "",
    coverage: normalizeOptionalString(data.coverage, 1_000) ?? "Whole folder",
    // Legacy quick/standard records remain readable, but every new or reopened
    // paper is treated as one complete sitting.
    length: isLength(data.length) ? data.length : "full",
    focus: isFocus(data.focus) ? data.focus : "balanced",
    focusDetail: normalizeOptionalString(data.focusDetail, 1_000),
    durationMinutes: Math.max(0, finiteInteger(data.durationMinutes)),
    timingMode: isTimingMode(data.timingMode)
      ? data.timingMode
      : data.timerEnabled === true
        ? "timed"
        : "untimed",
    timingState: isTimingState(data.timingState)
      ? data.timingState
      : data.status === "in_progress"
        ? "running"
        : data.status === "submitted" || data.status === "marked"
          ? "submitted"
          : "not_started",
    deadlineAt: finiteInteger(data.deadlineAt) || undefined,
    pausedAt: finiteInteger(data.pausedAt) || undefined,
    totalPausedMs: finiteInteger(data.totalPausedMs),
    overtimeStartedAt: finiteInteger(data.overtimeStartedAt) || undefined,
    deadlineSnapshotAt: finiteInteger(data.deadlineSnapshotAt) || undefined,
    deadlineVersion: finiteInteger(data.deadlineVersion),
    tutorEnabled: data.tutorEnabled === true,
    tutorUsed: data.tutorUsed === true,
    timerEnabled: isTimingMode(data.timingMode)
      ? data.timingMode === "timed"
      : data.timerEnabled === true,
    instructions: normalizeTextList(data.instructions, 20),
    assessmentProfile: normalizePracticePaperAssessmentProfile(data.assessmentProfile),
    questions,
    choiceGroups,
    totalMarks: totalMarks || finiteInteger(data.totalMarks),
    markScheme: normalizePracticePaperMarkScheme(data.markScheme, questions),
    markSchemeSourceId: normalizeOptionalString(data.markSchemeSourceId, 160),
    preparedAt: finiteInteger(data.preparedAt) || undefined,
    startedAt: finiteInteger(data.startedAt) || undefined,
    submittedAt: finiteInteger(data.submittedAt) || undefined,
    markedAt: finiteInteger(data.markedAt) || undefined,
    result: normalizePracticePaperResult(data.result),
    withinTimeResult: normalizePracticePaperResult(data.withinTimeResult),
    overtimeMarksGained: finiteInteger(data.overtimeMarksGained) || undefined,
    markingAudit: normalizePracticePaperMarkingAudit(data.markingAudit),
    withinTimeMarkingAudit: normalizePracticePaperMarkingAudit(
      data.withinTimeMarkingAudit
    ),
    remarkAudits: normalizePracticePaperRemarkAudits(data.remarkAudits),
    generationAudit: normalizePracticePaperGenerationAudit(data.generationAudit),
    researchReceipt: normalizePracticePaperResearchReceipt(data.researchReceipt),
    gradeGuidance: normalizePracticePaperGradeGuidance(data.gradeGuidance),
    examinerInsights: normalizeTextList(data.examinerInsights, 12, 500),
    activeAttemptId: normalizeOptionalString(data.activeAttemptId, 160),
    attemptCount: finiteInteger(data.attemptCount),
    createdAt: finiteInteger(data.createdAt),
    updatedAt: finiteInteger(data.updatedAt),
  };
}

export function buildPracticePaperPayload(
  input: Omit<PracticePaper, "id" | "createdAt" | "updatedAt"> & { now?: number }
) {
  const now = input.now ?? Date.now();
  const paper = { ...input };
  delete paper.now;
  return {
    ...paper,
    sourceIds: normalizeStringArray(
      input.sourceIds,
      MAX_PRACTICE_PAPER_SOURCE_IDS,
      160
    ),
    sourceLabels: normalizeTextList(
      input.sourceLabels,
      MAX_PRACTICE_PAPER_SOURCE_IDS,
      160
    ),
    questions: normalizePracticePaperQuestions(input.questions),
    choiceGroups: normalizePracticePaperChoiceGroups(
      input.choiceGroups,
      input.questions
    ),
    markScheme: toPublicPracticePaperMarkScheme(
      normalizePracticePaperMarkScheme(input.markScheme, input.questions)
    ),
    focusDetail: input.focusDetail?.trim().slice(0, 1_000) || null,
    markSchemeSourceId: input.markSchemeSourceId?.trim().slice(0, 160) || null,
    preparedAt: input.preparedAt ?? null,
    startedAt: input.startedAt ?? null,
    submittedAt: input.submittedAt ?? null,
    markedAt: input.markedAt ?? null,
    result: input.result ?? null,
    activeAttemptId: input.activeAttemptId?.trim().slice(0, 160) || null,
    createdAt: now,
    updatedAt: now,
  };
}

export function getPracticePaperQuestionLimit(length: PracticePaperLength) {
  void length;
  return 30;
}

export function getPracticePaperTargetMarks(length: PracticePaperLength) {
  void length;
  return 100;
}
