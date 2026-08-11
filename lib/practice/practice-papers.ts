import {
  normalizeOptionalString,
  normalizeStringArray,
} from "@/lib/material/content";

export const MAX_PRACTICE_PAPER_SOURCE_IDS = 15;
export const MAX_PRACTICE_PAPER_QUESTIONS = 30;

export type PracticePaperOrigin = "generated" | "uploaded";
export type PracticePaperStatus =
  | "setup"
  | "ready"
  | "in_progress"
  | "submitted"
  | "marked";
export type PracticePaperLength = "quick" | "standard" | "full";
export type PracticePaperFocus = "balanced" | "weak_areas" | "custom";
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
  | "source_extract";

export type PracticePaperQuestionAsset = {
  id: string;
  type: PracticePaperAssetType;
  title: string;
  content: string;
  altText: string;
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
};

export type PracticePaperMarkSchemeItem = {
  questionId: string;
  maxMarks: number;
  answer: string;
  criteria: string[];
  acceptableAlternatives: string[];
  commonMistakes: string[];
};

export type PracticePaperMarkScheme = {
  kind: PracticePaperMarkSchemeKind;
  label: string;
  notice: string;
  items: PracticePaperMarkSchemeItem[];
};

export type PracticePaperQuestionResult = {
  questionId: string;
  label: string;
  awardedMarks: number;
  maxMarks: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  confidence: PracticePaperConfidence;
  transcriptionNote?: string;
  counted: boolean;
  manualReason?: string;
  attempted: boolean;
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
  submittedAt?: number;
  markedAt?: number;
  result?: PracticePaperResult;
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
  return value === "quick" || value === "standard" || value === "full";
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
    value === "source_extract"
  );
}

export function normalizeQuestionAssets(value: unknown): PracticePaperQuestionAsset[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const asset = candidate as Record<string, unknown>;
    if (!isAssetType(asset.type)) return [];
    const content = normalizeOptionalString(asset.content, 6_000) ?? "";
    if (!content) return [];
    return [{
      id: normalizeOptionalString(asset.id, 80) ?? `asset-${index + 1}`,
      type: asset.type,
      title: normalizeOptionalString(asset.title, 160) ?? "Supporting material",
      content,
      altText: normalizeOptionalString(asset.altText, 500) ?? "",
    }];
  });
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
  const boundaries = Array.isArray(guidance.boundaries)
    ? guidance.boundaries.slice(0, 20).flatMap((candidate) => {
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
  const kind = guidance.kind === "official" || guidance.kind === "estimated"
    ? guidance.kind
    : "none";
  return {
    kind: boundaries.length > 0 ? kind : "none",
    label: normalizeOptionalString(guidance.label, 160) ?? "No grade guidance",
    notice: normalizeOptionalString(guidance.notice, 500) ?? "",
    boundaries: boundaries.sort(
      (left, right) => right.minimumPercentage - left.minimumPercentage
    ),
  };
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
  const percentage = result.totalMarks > 0
    ? Math.round((awarded / result.totalMarks) * 1_000) / 10
    : 0;
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
      seen.add(questionId);
      items.push({
        questionId,
        maxMarks: question.marks,
        answer: normalizeOptionalString(item.answer, 4_000) ?? "",
        criteria: normalizeTextList(item.criteria, 30),
        acceptableAlternatives: normalizeTextList(item.acceptableAlternatives, 20),
        commonMistakes: normalizeTextList(item.commonMistakes, 20),
      });
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
      return [{
        questionId,
        label: normalizeOptionalString(item.label, 80) ?? questionId,
        awardedMarks: Math.min(maxMarks, finiteInteger(item.awardedMarks)),
        maxMarks,
        feedback: normalizeOptionalString(item.feedback, 2_000) ?? "",
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
    percentage:
      totalMarks > 0
        ? Math.round((awardedMarks / totalMarks) * 1_000) / 10
        : 0,
    summary: normalizeOptionalString(result.summary, 2_000) ?? "",
    strengths: normalizeTextList(result.strengths, 10),
    priorities: normalizeTextList(result.priorities, 10),
    questionResults,
    gradeLabel: normalizeOptionalString(result.gradeLabel, 80),
  };
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
    submittedAt: finiteInteger(data.submittedAt) || undefined,
    markedAt: finiteInteger(data.markedAt) || undefined,
    result: normalizePracticePaperResult(data.result),
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
    length: isLength(data.length) ? data.length : "standard",
    focus: isFocus(data.focus) ? data.focus : "balanced",
    focusDetail: normalizeOptionalString(data.focusDetail, 1_000),
    durationMinutes: Math.max(0, finiteInteger(data.durationMinutes)),
    timerEnabled: data.timerEnabled === true,
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
    markScheme: normalizePracticePaperMarkScheme(
      input.markScheme,
      input.questions
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
  return length === "quick" ? 6 : length === "standard" ? 12 : 30;
}

export function getPracticePaperTargetMarks(length: PracticePaperLength) {
  return length === "quick" ? 20 : length === "standard" ? 50 : 100;
}
