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
  supervisorApproved: boolean;
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
  humanChecked: boolean;
  selectionKey: number;
  createdAt: number;
  updatedAt: number;
};

export type ExamQuestionSecret = {
  questionId: string;
  markSchemeItem: PracticePaperMarkSchemeItem;
  officialMarkScheme: string;
  modelAnswer?: string;
  examinerNotes: string[];
  acceptableAlternatives: string[];
  sourceDocumentHash: string;
};

export type ExamSessionQuestion = Pick<
  ExamQuestion,
  "id" | "label" | "prompt" | "marks" | "assets" | "difficulty" | "origin" | "provenance"
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

export function examBoardAppliesTo(level: StudyLevel | null | undefined) {
  return level === "early-secondary" || level === "gcse-equivalent" || level === "post-16-equivalent";
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
 * How much of an answer earns sight of the worked one.
 *
 * `attempted` is the marker's judgement and a single character can clear it,
 * which over a shared bank is a harvesting route: open twenty questions, type
 * a full stop into each, collect twenty model answers and mark schemes. So the
 * teaching material is unlocked by evidence of a real try -- a mark on the
 * board, or enough written to have been one.
 */
export const EXAM_MODEL_ANSWER_MIN_LENGTH = 40;

export function examAnswerUnlocksModelAnswer(
  result: Pick<PracticePaperQuestionResult, "attempted" | "awardedMarks">,
  answerText: string
) {
  return Boolean(result.attempted) &&
    (result.awardedMarks > 0 || answerText.trim().length >= EXAM_MODEL_ANSWER_MIN_LENGTH);
}

/** An unattempted response must not reveal answer-bearing teaching material. */
export function examResultForAttempt(
  result: PracticePaperQuestionResult,
  answerText = ""
): PracticePaperQuestionResult {
  if (!result.attempted) {
    return {
      questionId: result.questionId, label: result.label, awardedMarks: 0,
      maxMarks: result.maxMarks, feedback: "There wasn't enough of an answer to mark.",
      strengths: [], improvements: [], confidence: result.confidence,
      counted: true, attempted: false,
    };
  }
  // The mark, the criteria and the feedback are always the student's. Only the
  // worked answer waits for a real attempt.
  if (examAnswerUnlocksModelAnswer(result, answerText)) return result;
  const withheld = { ...result };
  delete withheld.modelAnswer;
  return withheld;
}
