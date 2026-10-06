import { normalizeNonNegativeInteger, normalizeOptionalString, normalizeStringArray } from "@/lib/material/content";
import {
  calculatePracticePaperPercentage,
  getPracticePaperGradeLabel,
} from "@/lib/practice/practice-paper-grades";
import { isConfidence, isTimingMode, isTimingState } from "@/lib/practice/practice-paper-fields";
import { normalizeManualCorrectionAudits, normalizePracticePaperMarkRange } from "@/lib/practice/practice-paper-marking-types";
import {
  MAX_PRACTICE_PAPER_QUESTIONS,
  type PracticePaperAttempt,
  type PracticePaperGradeGuidance,
  type PracticePaperMarkingAudit,
  type PracticePaperQuestionResult,
  type PracticePaperRemarkAudit,
  type PracticePaperResult,
} from "@/lib/practice/practice-papers";

/*
 * A practice paper's marks, as stored: its result, the audits behind it, and
 * each attempt at it. Read from Firestore as untrusted data, so every field is
 * bounded and every unknown value falls back rather than passing through.
 */

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
          markRange: undefined,
          evidenceWarnings: [],
        }
      : question
  );
  const awarded = questionResults.reduce(
    (total, question) => total + (question.counted ? question.awardedMarks : 0),
    0
  );
  const percentage = calculatePracticePaperPercentage(awarded, result.totalMarks);
  const previousRange = result.markRange;
  const lowerDistance = previousRange
    ? result.awardedMarks - previousRange.lower
    : 0;
  const upperDistance = previousRange
    ? previousRange.upper - result.awardedMarks
    : 0;
  return {
    ...result,
    questionResults,
    awardedMarks: awarded,
    percentage,
    gradeLabel: getPracticePaperGradeLabel(percentage, guidance),
    markRange: previousRange
      ? {
          ...previousRange,
          lower: Math.max(0, awarded - lowerDistance),
          upper: Math.min(result.totalMarks, awarded + upperDistance),
          reasons: Array.from(new Set([
            ...previousRange.reasons,
            "A student correction is fixed at the mark you entered.",
          ])).slice(0, 6),
        }
      : undefined,
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
      const maxMarks = Math.max(0, normalizeNonNegativeInteger(item.maxMarks));
      const criterionResults = Array.isArray(item.criterionResults)
        ? item.criterionResults.slice(0, 40).flatMap((candidate) => {
            if (!candidate || typeof candidate !== "object") return [];
            const criterion = candidate as Record<string, unknown>;
            const label = normalizeOptionalString(criterion.criterion, 800) ?? "";
            const criterionId = normalizeOptionalString(criterion.criterionId, 16);
            if (!label && !criterionId) return [];
            return [{
              ...(criterionId ? { criterionId } : {}),
              criterion: label || (criterionId ?? ""),
              awarded: criterion.awarded === true,
              evidence: normalizeOptionalString(criterion.evidence, 1_000) ?? "",
              ...(normalizeOptionalString(criterion.schemeValue, 200)
                ? { schemeValue: normalizeOptionalString(criterion.schemeValue, 200)! }
                : {}),
              ...(normalizeOptionalString(criterion.candidateValue, 200)
                ? { candidateValue: normalizeOptionalString(criterion.candidateValue, 200)! }
                : {}),
              ...(Number.isFinite(Number(criterion.awardedMarks))
                ? { awardedMarks: Math.max(0, normalizeNonNegativeInteger(criterion.awardedMarks)) }
                : {}),
              ...(Number.isFinite(Number(criterion.maxMarks))
                ? { maxMarks: Math.max(0, normalizeNonNegativeInteger(criterion.maxMarks)) }
                : {}),
            }];
          })
        : [];
      return [{
        questionId,
        label: normalizeOptionalString(item.label, 80) ?? questionId,
        awardedMarks: Math.min(maxMarks, normalizeNonNegativeInteger(item.awardedMarks)),
        maxMarks,
        feedback: normalizeOptionalString(item.feedback, 2_000) ?? "",
        criterionResults,
        evidence: normalizeStringArray(item.evidence, 12, 1_000),
        correction: normalizeOptionalString(item.correction, 2_000) ?? "",
        nextStep: normalizeOptionalString(item.nextStep, 1_000) ?? "",
        modelAnswer: normalizeOptionalString(item.modelAnswer, 4_000) ?? "",
        strengths: normalizeStringArray(item.strengths, 8, 800),
        improvements: normalizeStringArray(item.improvements, 8, 800),
        confidence: isConfidence(item.confidence) ? item.confidence : "medium",
        transcriptionNote: normalizeOptionalString(item.transcriptionNote, 500),
        counted: item.counted !== false,
        manualReason: normalizeOptionalString(item.manualReason, 500),
        attempted: item.attempted === true || normalizeNonNegativeInteger(item.awardedMarks) > 0,
        markRange: normalizePracticePaperMarkRange(item.markRange, maxMarks),
        evidenceWarnings: normalizeStringArray(item.evidenceWarnings, 8, 500),
      }];
    });
}

export function normalizePracticePaperResult(value: unknown): PracticePaperResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  const questionResults = normalizeQuestionResults(result.questionResults);
  const declaredTotalMarks = normalizeNonNegativeInteger(result.totalMarks);
  const totalMarks = declaredTotalMarks > 0
    ? declaredTotalMarks
    : questionResults.reduce((total, item) => total + item.maxMarks, 0);
  const awardedMarks = Math.min(
    totalMarks,
    normalizeNonNegativeInteger(
      result.awardedMarks,
      questionResults.reduce((total, item) => total + item.awardedMarks, 0)
    )
  );
  return {
    awardedMarks,
    totalMarks,
    percentage: calculatePracticePaperPercentage(awardedMarks, totalMarks),
    summary: normalizeOptionalString(result.summary, 2_000) ?? "",
    strengths: normalizeStringArray(result.strengths, 10, 800),
    priorities: normalizeStringArray(result.priorities, 10, 800),
    markRange: normalizePracticePaperMarkRange(result.markRange, totalMarks),
    gradeEstimateKind:
      result.gradeEstimateKind === "official" ? "official" :
        result.gradeEstimateKind === "estimated" ? "estimated" : undefined,
    evidenceWarnings: normalizeStringArray(result.evidenceWarnings, 12, 500),
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
    version: Math.max(1, normalizeNonNegativeInteger(audit.version, 1)),
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
    createdAt: normalizeNonNegativeInteger(audit.createdAt),
  };
}

export function normalizePracticePaperRemarkAudits(
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
      previousMarks: normalizeNonNegativeInteger(audit.previousMarks),
      revisedMarks: normalizeNonNegativeInteger(audit.revisedMarks),
      markingAudit,
      createdAt: normalizeNonNegativeInteger(audit.createdAt),
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
    attemptNumber: Math.max(1, normalizeNonNegativeInteger(data.attemptNumber, 1)),
    status,
    startedAt: normalizeNonNegativeInteger(data.startedAt),
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
    durationMinutes: normalizeNonNegativeInteger(data.durationMinutes),
    deadlineAt: normalizeNonNegativeInteger(data.deadlineAt) || undefined,
    pausedAt: normalizeNonNegativeInteger(data.pausedAt) || undefined,
    totalPausedMs: normalizeNonNegativeInteger(data.totalPausedMs),
    overtimeStartedAt: normalizeNonNegativeInteger(data.overtimeStartedAt) || undefined,
    deadlineSnapshotAt: normalizeNonNegativeInteger(data.deadlineSnapshotAt) || undefined,
    deadlineVersion: normalizeNonNegativeInteger(data.deadlineVersion),
    tutorEnabled: data.tutorEnabled === true,
    tutorUsed: data.tutorUsed === true,
    assisted: data.assisted === true || data.tutorEnabled === true,
    submittedAt: normalizeNonNegativeInteger(data.submittedAt) || undefined,
    markedAt: normalizeNonNegativeInteger(data.markedAt) || undefined,
    result: normalizePracticePaperResult(data.result),
    withinTimeResult: normalizePracticePaperResult(data.withinTimeResult),
    overtimeMarksGained: normalizeNonNegativeInteger(data.overtimeMarksGained) || undefined,
    markingAudit: normalizePracticePaperMarkingAudit(data.markingAudit),
    withinTimeMarkingAudit: normalizePracticePaperMarkingAudit(
      data.withinTimeMarkingAudit
    ),
    remarkAudits: normalizePracticePaperRemarkAudits(data.remarkAudits),
    manualCorrectionAudits: normalizeManualCorrectionAudits(data.manualCorrectionAudits),
    createdAt: normalizeNonNegativeInteger(data.createdAt),
    updatedAt: normalizeNonNegativeInteger(data.updatedAt),
  };
}
