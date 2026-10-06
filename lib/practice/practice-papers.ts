import {
  normalizeNonNegativeInteger,
  normalizeOptionalString,
  normalizeStringArray,
} from "@/lib/material/content";
import { filterCanonicalConceptIds } from "@/lib/practice/exam-specification-concepts";
import { normalizePracticePaperGradeGuidance } from "@/lib/practice/practice-paper-grades";
import {
  normalizePracticePaperMarkingAudit,
  normalizePracticePaperRemarkAudits,
  normalizePracticePaperResult,
} from "@/lib/practice/practice-paper-results";
import {
  normalizeMarkSchemeItem,
  type PracticePaperMarkSchemeItem,
} from "@/lib/practice/mark-schemes";
import {
  normalizePracticePaperCompanionDocuments,
  type ExamFormatVerificationStatus,
  type PracticePaperBrief,
  type PracticePaperCompanionDocument,
} from "@/lib/practice/exam-formats";
import { normalizeManualCorrectionAudits, type PracticePaperManualCorrectionAudit, type PracticePaperMarkRange } from "@/lib/practice/practice-paper-marking-types";
import { normalizePracticePaperPdfLayout, type PracticePaperPdfLayout } from "@/lib/practice/paper-pdf-layout";
import { normalizePracticePaperCorpusCalibration, type PracticePaperCorpusCalibration } from "@/lib/practice/paper-corpus-calibration";
import {
  isAssetSource,
  isAssetType,
  isAssetValidationStatus,
  isConfidence,
  isFocus,
  isLength,
  isMarkSchemeKind,
  isStatus,
  isTimingMode,
  isTimingState,
  type PracticePaperAssetSource,
  type PracticePaperAssetType,
  type PracticePaperAssetValidationStatus,
  type PracticePaperConfidence,
  type PracticePaperFocus,
  type PracticePaperLength,
  type PracticePaperMarkSchemeKind,
  type PracticePaperOrigin,
  type PracticePaperStatus,
  type PracticePaperTimingMode,
  type PracticePaperTimingState,
} from "@/lib/practice/practice-paper-fields";
export type {
  PracticePaperAssetSource,
  PracticePaperAssetType,
  PracticePaperAssetValidationStatus,
  PracticePaperConfidence,
  PracticePaperFocus,
  PracticePaperLength,
  PracticePaperMarkSchemeKind,
  PracticePaperOrigin,
  PracticePaperStatus,
  PracticePaperTimingMode,
  PracticePaperTimingState,
} from "@/lib/practice/practice-paper-fields";
export { mapPracticePaperMarkingJobData } from "@/lib/practice/practice-paper-marking-types";
export { mapPracticePaperJobData } from "@/lib/practice/practice-paper-jobs";
export type { PracticePaperEvidenceIssue, PracticePaperEvidenceManifest, PracticePaperEvidencePage, PracticePaperManualCorrectionAudit, PracticePaperMarkingJob, PracticePaperMarkingJobKind, PracticePaperMarkingJobStage, PracticePaperMarkingJobStatus, PracticePaperMarkRange } from "@/lib/practice/practice-paper-marking-types";

/**
 * How many files one paper may be built from. Not shown to students: it was 15,
 * which a module's lecture notes alone could pass, and it bought nothing -- the
 * real bound is the size cap when the files are read, which fits the material
 * to it rather than refusing. This only stops a runaway request.
 */
export const MAX_PRACTICE_PAPER_SOURCE_IDS = 100;
/**
 * How much read text one paper's material may come to: the designer's context
 * is what actually bounds a paper, and this is the worst case it was measured
 * against -- fifteen sources at their 30,000-character reading cap. More files
 * than that are read in priority order until it is full.
 */
export const MAX_PRACTICE_PAPER_SOURCE_TEXT = 15 * 30_000;
export const MAX_PRACTICE_PAPER_QUESTIONS = 30;

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
  | "needs_confirmation"
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
  paperBrief?: PracticePaperBrief;
  clarificationQuestion?: string;
  failureCode?: string;
  failureMessage?: string;
  /** The student cleared this failure from the Practice paper builder. */
  failureDismissed: boolean;
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
  profileId?: string;
  profileVersion?: string;
  verificationStatus?: ExamFormatVerificationStatus;
  effectiveFrom?: string;
  effectiveUntil?: string;
};

export type PracticePaperQuestion = {
  id: string;
  label: string;
  prompt: string;
  marks: number;
  assets: PracticePaperQuestionAsset[];
  /**
   * Which section of the paper this question belongs to, where the format has
   * sections.
   *
   * A question could not say. So a format profile describing "four sections of
   * 24 marks each" described something the paper could not represent, the
   * designer answered with a flat list, and nothing held it to the section
   * totals: ten drafts of the same 96-mark component came back at 80, 96, 97,
   * 136, 143, 154, 164, 169, 177 and 178 marks. One in ten was right.
   *
   * Optional because plenty of papers have no sections, and because every
   * stored paper predates this.
   */
  section?: string;
  /**
   * The specification concepts this question tests, where they are known.
   *
   * Written when the paper is generated: the pipeline is told which concepts
   * the paper is for and asks for each question to name the one it was written
   * against, so nothing has to be rediscovered afterwards from the wording.
   *
   * Absent on every paper generated before this existed, and absent means
   * absent -- the Learning Engine counts such a question towards recurring
   * errors and the overall trend, as it always did, and towards no concept at
   * all. Guessing a concept from the prompt is the inference the engine exists
   * to avoid making. See `scripts/eval/practice-concept-backfill.ts` for the
   * legacy path.
   */
  conceptIds?: string[];
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
  /**
   * The scheme's own identifier for this criterion, e.g. "C2".
   *
   * Optional because reports marked before criterion ids existed do not carry
   * one, and those must keep loading. New reports should always have it: it is
   * what makes two markers' criterion judgements comparable, since their prose
   * never matches.
   */
  criterionId?: string;
  criterion: string;
  awarded: boolean;
  evidence: string;
  /**
   * What the guide says this mark is for, and what the candidate actually
   * produced, written down before the verdict.
   *
   * Marking ran half a mark generous through every attempt to fix it, and the
   * one that asked the marker to check its working changed nothing: 12 marks
   * fixed against 9 broken, p = 0.66. Asking did not work, so the comparison is
   * required in the output instead -- a marker that has to write "the scheme
   * wants 7, the candidate wrote 10" is in a different position from one told
   * to be careful.
   *
   * Optional because every marking already stored predates them, and because a
   * criterion can be qualitative enough that no single value is meant.
   */
  schemeValue?: string;
  candidateValue?: string;
  /**
   * How many of this criterion's marks were given, where it carries more than
   * one.
   *
   * A boolean is exact for a scheme awarding one mark per bullet, which is what
   * every criterion source held until the coursework assignments arrived. There
   * a single section is worth up to ten, and `awarded: true` says only that
   * something was credited -- six out of ten and two out of ten are the same
   * answer, and so is nine. The essay branch could not be measured at all
   * through that lens.
   *
   * Optional: a one-mark criterion says everything in the boolean, and every
   * marking already stored predates this.
   */
  awardedMarks?: number;
  /**
   * What this criterion was worth, joined on from the scheme after marking.
   *
   * Without it a report can only ask whether a criterion scored anything, so
   * one mark out of three read as a success -- which is how an answer that
   * lost three marks was told nothing essential was missing.
   */
  maxMarks?: number;
};

export type PracticePaperQuestionResult = {
  /**
   * What reconciling this mark against its own criterion awards established.
   *
   * Absent means the question was never checked -- every result stored before
   * the check existed, and any built outside the marking parser. Present and
   * `unverifiable` means it was checked and could not be settled, which is a
   * different thing from passing and must never be reported as one: a marker
   * that names no criteria has nothing to reconcile, and calling that
   * agreement would bless exactly the reports showing their working least.
   *
   * `checked` records how far a pass actually went. Arithmetic is the strong
   * case. Bounds means only that a banded mark sits in a band the scheme
   * defines -- not that it is the right band. Tariff means only that the mark
   * does not exceed the question's worth.
   */
  markConsistency?: {
    status: "consistent" | "unverifiable";
    checked?: "arithmetic" | "bounds" | "tariff";
    detail?: string;
  };
  /**
   * Whether the quotations behind the award came from the student.
   *
   * Deliberately separate from `markConsistency`: one says the arithmetic
   * reconciles, the other says the evidence is the candidate's. A report can
   * add up perfectly while quoting the question back at itself, and reporting
   * that as a checked mark is the conflation this exists to prevent.
   *
   * `ungrounded` never overturns a mark on its own -- a marker paraphrasing a
   * correct answer is ungrounded and right -- so it is recorded rather than
   * enforced. `unverifiable` covers handwriting, which cannot be searched.
   */
  evidenceGrounding?: {
    status: "grounded" | "ungrounded" | "unverifiable";
    unmatched?: string[];
    detail?: string;
  };
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
  markRange?: PracticePaperMarkRange;
  evidenceWarnings?: string[];
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
  markRange?: PracticePaperMarkRange;
  gradeEstimateKind?: "official" | "estimated";
  evidenceWarnings?: string[];
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
  manualCorrectionAudits?: PracticePaperManualCorrectionAudit[];
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
  companionDocuments?: PracticePaperCompanionDocument[];
  pdfLayout?: PracticePaperPdfLayout;
  corpusCalibration?: PracticePaperCorpusCalibration;
  assessmentProfile: PracticePaperAssessmentProfile;
  questions: PracticePaperQuestion[];
  choiceGroups: PracticePaperChoiceGroup[];
  totalMarks: number;
  markScheme: PracticePaperMarkScheme;
  markSchemeSourceId?: string;
  /**
   * The recommendation that asked for this paper, when Jami wrote it. The same
   * provenance a generated card carries: without it a paper written in answer
   * to advice is indistinguishable from one the student made themselves, and
   * nothing can ask whether the advice was ever carried out.
   */
  createdByInterventionId?: string;
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
  manualCorrectionAudits?: PracticePaperManualCorrectionAudit[];
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
  companionDocuments?: PracticePaperCompanionDocument[];
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

export type { PracticePaperBrief, PracticePaperCompanionDocument };

function normalizeTextList(value: unknown, maximum: number, maxLength = 800) {
  return normalizeStringArray(value, maximum, maxLength);
}

export function normalizeQuestionAssets(value: unknown): PracticePaperQuestionAsset[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  return value.slice(0, 8).flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const asset = candidate as Record<string, unknown>;
    if (!isAssetType(asset.type)) return [];
    // Room for a drawn SVG figure, which a 6,000 cap cut off mid-path.
    const content = normalizeOptionalString(asset.content, 12_000) ?? "";
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
      width: normalizeNonNegativeInteger(asset.width) || undefined,
      height: normalizeNonNegativeInteger(asset.height) || undefined,
      source: isAssetSource(asset.source) ? asset.source : undefined,
      validationStatus: isAssetValidationStatus(asset.validationStatus)
        ? asset.validationStatus
        : undefined,
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
    profileId: normalizeOptionalString(profile.profileId, 180),
    profileVersion: normalizeOptionalString(profile.profileVersion, 120),
    verificationStatus:
      profile.verificationStatus === "verified" ||
      profile.verificationStatus === "limited" ||
      profile.verificationStatus === "conflicted" ||
      profile.verificationStatus === "custom"
        ? profile.verificationStatus
        : undefined,
    effectiveFrom: normalizeOptionalString(profile.effectiveFrom, 40),
    effectiveUntil: normalizeOptionalString(profile.effectiveUntil, 40),
  };
}

export function normalizePracticePaperQuestions(
  value: unknown,
  /** The course whose catalogue any concept id must belong to; without it, none are kept. */
  specificationId?: string
) {
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
    /*
     * Kept only where a checked catalogue holds the id. A concept the course
     * does not have is not a near miss worth correcting: it is a concept this
     * student's specification never mentions, and attributing evidence to it
     * would be worse than attributing none.
     */
    const conceptIds = specificationId
      ? filterCanonicalConceptIds(specificationId, normalizeStringArray(item.conceptIds, 8, 160))
          .conceptIds
      : [];
    questions.push({
      id,
      label: normalizeOptionalString(item.label, 80) ?? `Question ${questions.length + 1}`,
      prompt,
      marks: Math.max(1, normalizeNonNegativeInteger(item.marks, 1)),
      ...(normalizeOptionalString(item.section, 80)
        ? { section: normalizeOptionalString(item.section, 80)! }
        : {}),
      assets: normalizeQuestionAssets(item.assets),
      ...(conceptIds.length > 0 ? { conceptIds } : {}),
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
        Math.min(questionIds.length, normalizeNonNegativeInteger(group.requiredCount, 1))
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

function normalizePracticePaperGenerationAudit(
  value: unknown
): PracticePaperGenerationAudit | undefined {
  if (!value || typeof value !== "object") return undefined;
  const audit = value as Record<string, unknown>;
  return {
    issueCount: normalizeNonNegativeInteger(audit.issueCount),
    repaired: audit.repaired === true,
    createdAt: normalizeNonNegativeInteger(audit.createdAt),
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

function normalizePracticePaperResearchReceipt(
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

export function mapPracticePaperData(
  id: string,
  data: Record<string, unknown>,
  /**
   * The catalogue any stored concept id is checked against.
   *
   * The paper itself records its course only as the wording a student would
   * read ("AQA GCSE Mathematics 8300"), which is not a catalogue id. The
   * folder the paper lives in holds the real one, so the caller supplies it.
   * Without it no concept is kept, which is the safe direction: unattributed
   * evidence rather than evidence attributed to a course it is not from.
   */
  specificationId?: string
): PracticePaper {
  const questions = normalizePracticePaperQuestions(data.questions, specificationId);
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
    durationMinutes: Math.max(0, normalizeNonNegativeInteger(data.durationMinutes)),
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
    deadlineAt: normalizeNonNegativeInteger(data.deadlineAt) || undefined,
    pausedAt: normalizeNonNegativeInteger(data.pausedAt) || undefined,
    totalPausedMs: normalizeNonNegativeInteger(data.totalPausedMs),
    overtimeStartedAt: normalizeNonNegativeInteger(data.overtimeStartedAt) || undefined,
    deadlineSnapshotAt: normalizeNonNegativeInteger(data.deadlineSnapshotAt) || undefined,
    deadlineVersion: normalizeNonNegativeInteger(data.deadlineVersion),
    tutorEnabled: data.tutorEnabled === true,
    tutorUsed: data.tutorUsed === true,
    timerEnabled: isTimingMode(data.timingMode)
      ? data.timingMode === "timed"
      : data.timerEnabled === true,
    instructions: normalizeTextList(data.instructions, 20),
    companionDocuments: normalizePracticePaperCompanionDocuments(data.companionDocuments),
    pdfLayout: normalizePracticePaperPdfLayout(data.pdfLayout),
    corpusCalibration: normalizePracticePaperCorpusCalibration(data.corpusCalibration),
    assessmentProfile: normalizePracticePaperAssessmentProfile(data.assessmentProfile),
    questions,
    choiceGroups,
    totalMarks: totalMarks || normalizeNonNegativeInteger(data.totalMarks),
    markScheme: normalizePracticePaperMarkScheme(data.markScheme, questions),
    markSchemeSourceId: normalizeOptionalString(data.markSchemeSourceId, 160),
    createdByInterventionId: normalizeOptionalString(data.createdByInterventionId, 400),
    preparedAt: normalizeNonNegativeInteger(data.preparedAt) || undefined,
    startedAt: normalizeNonNegativeInteger(data.startedAt) || undefined,
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
    generationAudit: normalizePracticePaperGenerationAudit(data.generationAudit),
    researchReceipt: normalizePracticePaperResearchReceipt(data.researchReceipt),
    gradeGuidance: normalizePracticePaperGradeGuidance(data.gradeGuidance),
    examinerInsights: normalizeTextList(data.examinerInsights, 12, 500),
    activeAttemptId: normalizeOptionalString(data.activeAttemptId, 160),
    attemptCount: normalizeNonNegativeInteger(data.attemptCount),
    createdAt: normalizeNonNegativeInteger(data.createdAt),
    updatedAt: normalizeNonNegativeInteger(data.updatedAt),
  };
}

export function buildPracticePaperPayload(
  input: Omit<PracticePaper, "id" | "createdAt" | "updatedAt"> & { now?: number }
) {
  const now = input.now ?? Date.now();
  /*
   * Fields left undefined are left out. The browser's Firestore refuses a
   * document holding one, and an uploaded paper starts with its timer fields
   * -- `deadlineAt`, `pausedAt` and the rest -- deliberately unset, so every
   * upload failed here after its notebook had already been made.
   */
  const paper = Object.fromEntries(
    Object.entries(input).filter(([key, value]) => key !== "now" && value !== undefined)
  ) as Omit<typeof input, "now">;
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
    companionDocuments: normalizePracticePaperCompanionDocuments(input.companionDocuments),
    pdfLayout: normalizePracticePaperPdfLayout(input.pdfLayout) ?? null,
    corpusCalibration: normalizePracticePaperCorpusCalibration(input.corpusCalibration) ?? null,
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
    createdByInterventionId: input.createdByInterventionId?.trim().slice(0, 400) || null,
    preparedAt: input.preparedAt ?? null,
    startedAt: input.startedAt ?? null,
    submittedAt: input.submittedAt ?? null,
    markedAt: input.markedAt ?? null,
    result: input.result ?? null,
    activeAttemptId: input.activeAttemptId?.trim().slice(0, 160) || null,
    /*
     * Optional, and Firestore refuses a field set to undefined outright. A paper
     * generated without web research carries no receipt, and writing it as
     * undefined threw away the finished paper at the last step.
     */
    researchReceipt: input.researchReceipt ?? null,
    generationAudit: input.generationAudit ?? null,
    gradeGuidance: input.gradeGuidance ?? null,
    examinerInsights: input.examinerInsights ?? null,
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
