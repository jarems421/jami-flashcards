import type { PracticePaperQuestionAsset, PracticePaperQuestionResult } from "@/lib/practice/practice-papers";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";
import type { ExamBoardId, ExamQualification } from "@/lib/practice/exam-formats";
import type { StudyLevel } from "@/lib/profile/study-level";

export type ExamDifficulty = "easy" | "medium" | "hard";
export type ExamQuestionOrigin = "official_past_paper" | "jami_generated";
export type ExamQuestionStatus = "draft" | "needs_review" | "published" | "withdrawn";
export type ExamAttemptStatus = "draft" | "marking" | "marked" | "marking_failed" | "deleted";

export type ExamCourseSelection = {
  board: ExamBoardId;
  qualification: ExamQualification;
  specificationId: string;
  specificationTitle: string;
  tier?: string;
  componentIds: string[];
};

export type ExamRightsSnapshot = {
  key: string;
  version: number;
  verified: boolean;
  storageAllowed: boolean;
  studentDisplayAllowed: boolean;
  aiInferenceAllowed: boolean;
  revoked: boolean;
};

export type ExamPaper = {
  id: string;
  board: ExamBoardId;
  qualification: ExamQualification;
  specificationId: string;
  specificationVersion: string;
  subject: string;
  series: string;
  year: number;
  paperReference: string;
  activeFrom: number;
  activeUntil?: number;
  questionPaperUrl: string;
  markSchemeUrl: string;
  questionPaperSha256: string;
  markSchemeSha256: string;
  questionPaperStoragePath: string;
  markSchemeStoragePath: string;
  rights: ExamRightsSnapshot;
  status: "discovered" | "extracting" | "needs_review" | "published" | "withdrawn";
  createdAt: number;
  updatedAt: number;
};

export type ExamIngestionVerification = {
  paperIdentityMatches: boolean;
  questionLabelMatches: boolean;
  tariffMatches: boolean;
  markSchemeLabelMatches: boolean;
  questionComplete: boolean;
  assetsComplete: boolean;
  specificationCurrent: boolean;
  issues: string[];
};

export type ExamQuestionProvenance = {
  board: ExamBoardId;
  boardLabel: string;
  qualification: ExamQualification;
  specificationId: string;
  specificationTitle: string;
  componentCode: string;
  componentTitle: string;
  year: number;
  series: string;
  paperReference: string;
  questionNumber: string;
  sourceUrl: string;
  sourceSha256: string;
};

/**
 * Who signed off an extracted question, and what they said.
 *
 * The gate is not "a person looked at it" but "somebody competent approved
 * it", and `by` records which -- so if model review later turns out to be
 * unreliable, every question it approved can be found and revoked as a class
 * rather than hunted for. A question with no review at all is pending, which
 * is the same as rejected for anything a student can reach.
 */
export type ExamQuestionReviewer = "human" | "ai";

export type ExamQuestionReview = {
  /** `review_failed` is an outage, not a verdict: it stays in the queue. */
  status: "pending" | "approved" | "rejected" | "review_failed";
  by?: ExamQuestionReviewer;
  /** Set when `by` is "human". */
  reviewerUid?: string;
  /** Set when `by` is "ai", so a bad reviewer model is traceable. */
  model?: string;
  at?: number;
  notes: string[];
};

export function isExamQuestionApproved(
  review: ExamQuestionReview | undefined | null
) {
  return review?.status === "approved";
}

export type ExamQuestion = {
  id: string;
  paperId: string;
  subject: string;
  subjectKey: string;
  studyLevel: StudyLevel;
  label: string;
  prompt: string;
  marks: number;
  assets: PracticePaperQuestionAsset[];
  /** Server-private extraction evidence, never candidate question material. */
  reviewAssets?: PracticePaperQuestionAsset[];
  commandWord?: string;
  topicIds: string[];
  tier?: string;
  calculatorAllowed?: boolean;
  difficulty: ExamDifficulty;
  aiDifficulty: ExamDifficulty;
  difficultyScore: number;
  difficultySource: "ai_ingest" | "student_data";
  origin: ExamQuestionOrigin;
  provenance: ExamQuestionProvenance;
  rights: ExamRightsSnapshot;
  status: ExamQuestionStatus;
  review: ExamQuestionReview;
  /**
   * What this question currently says, as a hash of its own content.
   *
   * A session snapshots a question's wording but marking loads the scheme by
   * id, so re-ingesting a paper used to mark a student against a scheme that
   * no longer belonged to the question in front of them. The version travels
   * with the session, and marking will not use a scheme that does not match
   * it.
   */
  contentVersion: string;
  selectionKey: number;
  createdAt: number;
  updatedAt: number;
};

export type ExamQuestionSecret = {
  questionId: string;
  /** Matches the question's, so a scheme cannot drift from its question. */
  contentVersion: string;
  markSchemeItem: PracticePaperMarkSchemeItem;
  officialMarkScheme: string;
  modelAnswer?: string;
  examinerNotes: string[];
  acceptableAlternatives: string[];
  sourceDocumentHash: string;
};

export type ExamSessionQuestion = Pick<
  ExamQuestion,
  | "id"
  | "label"
  | "prompt"
  | "marks"
  | "assets"
  | "difficulty"
  | "origin"
  | "provenance"
  | "contentVersion"
> & { attemptId: string };

export type ExamSession = {
  id: string;
  userId: string;
  folderId: string;
  folderName: string;
  subject: string;
  studyLevel: StudyLevel;
  course: ExamCourseSelection;
  requestedMix: Record<ExamDifficulty, number>;
  topicIds: string[];
  questions: ExamSessionQuestion[];
  status: "active" | "completed" | "abandoned";
  currentQuestionId?: string;
  answeredCount: number;
  awardedTotal: number;
  /**
   * The marks of the questions actually marked so far.
   *
   * A session in progress was scored against the whole paper, so one perfect
   * answer of five questions read as 20% and looked exactly like a completed
   * session that went badly. Absent on sessions that predate this, where the
   * full total is the only denominator there is.
   */
  assessedTotal?: number;
  maxTotal: number;
  originNotebookId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  answersDeletedAt?: number;
};

export type ExamMarkingAudit = {
  primaryScore: number;
  verifierScore?: number;
  reviewedScore?: number;
  adaptivelyVerified: boolean;
  adjudicated: boolean;
  studentReviewed: boolean;
};

export type ExamAttempt = {
  id: string;
  userId: string;
  sessionId: string;
  questionId: string;
  attemptNumber: 1 | 2;
  answerText: string;
  status: ExamAttemptStatus;
  result?: PracticePaperQuestionResult;
  officialMarkScheme?: string;
  audit?: ExamMarkingAudit;
  workingIncluded: boolean;
  workingSnapshotPath?: string;
  statsContributionFraction?: number;
  reviewUsed: boolean;
  reviewStatus?: "reviewing" | "failed" | "complete";
  reviewOriginalScore?: number;
  answerDeletedAt?: number;
  workingWidth?: number;
  workingHeight?: number;
  startedAt: number;
  submittedAt?: number;
  markedAt?: number;
  updatedAt: number;
};

export const EXAM_SESSION_MAX_QUESTIONS = 20;
export const EXAM_ANSWER_MAX_LENGTH = 30_000;
export const EXAM_WORKING_MAX_BYTES = 3 * 1024 * 1024;
export const EXAM_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;

/**
 * How long a marking or review operation holds its claim on an attempt.
 *
 * The route that starts one has 60 seconds to live, so an attempt still
 * marked `marking` well after that is not in progress -- it is the remains of
 * a request that was killed mid-flight, and nothing will ever finish it.
 *
 * It matters beyond the attempt itself. Finishing a session and deleting its
 * answers both refuse while anything is being marked, and they read the same
 * flag, so one dead request used to lock a student out of their own session
 * permanently with "wait for marking to finish".
 */
export const EXAM_OPERATION_LEASE_MS = 90_000;

/** Whether an attempt is genuinely being worked on right now. */
export function examOperationIsLive(
  attempt: { status?: unknown; reviewStatus?: unknown; updatedAt?: unknown; reviewStartedAt?: unknown },
  now: number
) {
  const since = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  if (attempt.status === "marking" && now - since(attempt.updatedAt) < EXAM_OPERATION_LEASE_MS) return true;
  if (attempt.reviewStatus === "reviewing" && now - since(attempt.reviewStartedAt) < EXAM_OPERATION_LEASE_MS) {
    return true;
  }
  return false;
}

export function examBoardAppliesTo(level: StudyLevel | null | undefined) {
  return level === "early-secondary" || level === "gcse-equivalent" || level === "post-16-equivalent";
}

/**
 * A course selection with its absent optional fields left out.
 *
 * `tier: undefined` is not the same as no tier: Firestore rejects an explicit
 * undefined outright, neither SDK here enables `ignoreUndefinedProperties`,
 * and this codebase has been bitten by exactly that before. Writing it meant
 * every course without a tier -- which is most A-level subjects -- failed to
 * save, and the student was told their course could not be saved with no way
 * to tell why.
 */
export function buildExamCourseSelection(input: {
  board: ExamBoardId;
  qualification: ExamQualification;
  specificationId: string;
  specificationTitle: string;
  tier?: string;
  componentIds?: string[];
}): ExamCourseSelection {
  const tier = input.tier?.trim();
  return {
    board: input.board,
    qualification: input.qualification,
    specificationId: input.specificationId.trim(),
    specificationTitle: input.specificationTitle.trim(),
    componentIds: input.componentIds ?? [],
    ...(tier ? { tier } : {}),
  };
}

export function canServeExamRights(rights: ExamRightsSnapshot) {
  return rights.verified && rights.storageAllowed && rights.studentDisplayAllowed && rights.aiInferenceAllowed && !rights.revoked;
}

export function normalizeDifficultyMix(value: unknown): Record<ExamDifficulty, number> | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (["easy", "medium", "hard"].some((key) => input[key] !== undefined &&
    (typeof input[key] !== "number" || !Number.isInteger(input[key]) || input[key] < 0 || input[key] > 20))) return null;
  const read = (key: ExamDifficulty) =>
    typeof input[key] === "number" && Number.isInteger(input[key])
      ? Math.max(0, Math.min(EXAM_SESSION_MAX_QUESTIONS, input[key]))
      : 0;
  const mix = { easy: read("easy"), medium: read("medium"), hard: read("hard") };
  const total = mix.easy + mix.medium + mix.hard;
  return total >= 1 && total <= EXAM_SESSION_MAX_QUESTIONS ? mix : null;
}

/**
 * The one place that decides whether an extracted question may be published.
 *
 * Ingestion, review and selection all ask this, so a question cannot reach a
 * student through a door that checks less than the others. In particular an
 * approving reviewer does not override a structural failure: a mispaired mark
 * scheme or a question whose region could not be found is wrong however
 * confident anyone is about the wording.
 */
export function examQuestionPublicationBlockers(
  verification: ExamIngestionVerification | undefined
): string[] {
  if (!verification) return ["This question has no ingestion verification record."];
  const failed: string[] = [];
  if (!verification.paperIdentityMatches) failed.push("The paper does not identify itself as the one ingested.");
  if (!verification.questionLabelMatches) failed.push("The question label was not found on the paper.");
  if (!verification.tariffMatches) failed.push("The tariff does not match the one printed on the paper.");
  if (!verification.markSchemeLabelMatches) failed.push("The mark scheme could not be paired to this question.");
  if (!verification.questionComplete) failed.push("The question or its scheme is incomplete.");
  if (!verification.assetsComplete) failed.push("The question's own region of the paper is missing.");
  if (!verification.specificationCurrent) failed.push("The specification is not current.");
  return failed;
}

export function canPublishExamQuestion(verification: ExamIngestionVerification | undefined) {
  return examQuestionPublicationBlockers(verification).length === 0;
}

export function isCurrentSpecificationQuestion(question: Pick<ExamQuestion, "status" | "rights">) {
  return question.status === "published" && canServeExamRights(question.rights);
}

/** JSON-shaped domain objects must not persist explicit undefined fields. */
export function examDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function questionMatchesExamCourse(question: ExamQuestion, course: ExamCourseSelection) {
  return question.origin === "official_past_paper" &&
    question.provenance.board === course.board &&
    question.provenance.qualification === course.qualification &&
    question.provenance.specificationId === course.specificationId &&
    (!question.tier || question.tier === course.tier) &&
    (course.componentIds.length === 0 || course.componentIds.includes(question.provenance.componentCode));
}

/**
 * Whether a marked attempt may see the worked answer and the official scheme.
 *
 * Anything that reached the marker qualifies. The earlier bar -- a mark, or
 * forty typed characters -- withheld teaching material from exactly the
 * students who most needed it: a wrong numeric answer is three characters, and
 * a page of handwritten working is none at all.
 *
 * The harvesting that bar was guarding against is bounded elsewhere and more
 * appropriately: a session has to be created against a licensed course, every
 * request is authenticated, and marking is capped per day. An unattempted
 * response still reveals nothing, because there is nothing to teach about it.
 */
export function examAnswerUnlocksModelAnswer(
  result: Pick<PracticePaperQuestionResult, "attempted">
) {
  return Boolean(result.attempted);
}

/**
 * Each criterion's tariff, joined on from the scheme after marking.
 *
 * A marker reports what it awarded, never what was available, so the report
 * could only ask whether a criterion scored anything. One mark out of three
 * therefore counted as a success and never appeared among the things to do
 * better -- which is how an answer that lost three marks was told nothing
 * essential was missing.
 *
 * Joined by the scheme's own criterion ids, which is why both markers are
 * handed those ids in the first place. A criterion the marker invented has no
 * id, no match, and no tariff attached rather than a guessed one.
 */
export function withCriterionTariffs(
  result: PracticePaperQuestionResult,
  criteria: readonly { id: string; marks: number }[]
): PracticePaperQuestionResult {
  if (!result.criterionResults?.length) return result;
  const marksById = new Map(criteria.map((criterion) => [criterion.id, criterion.marks]));
  return {
    ...result,
    criterionResults: result.criterionResults.map((criterion) => {
      const marks = criterion.criterionId ? marksById.get(criterion.criterionId) : undefined;
      return typeof marks === "number" ? { ...criterion, maxMarks: marks } : criterion;
    }),
  };
}

/** An unattempted response must not reveal answer-bearing teaching material. */
export function examResultForAttempt(
  result: PracticePaperQuestionResult
): PracticePaperQuestionResult {
  if (!result.attempted) {
    return {
      questionId: result.questionId, label: result.label, awardedMarks: 0,
      maxMarks: result.maxMarks, feedback: "There wasn't enough of an answer to mark.",
      strengths: [], improvements: [], confidence: result.confidence,
      counted: true, attempted: false,
    };
  }
  return result;
}
