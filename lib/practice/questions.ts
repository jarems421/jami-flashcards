import {
  isContentOrigin,
  isContentStatus,
  normalizeOptionalString,
  normalizeStringArray,
  type ContentOrigin,
  type ContentStatus,
} from "@/lib/practice/content";

export type QuestionDifficulty = "easy" | "medium" | "hard";
export type QuestionSourceType = "manual" | "ai-generated" | "imported" | "past-paper";

export type Question = {
  id: string;
  questionText: string;
  answerText?: string;
  solutionText?: string;
  markScheme?: string;
  folderIds: string[];
  topicIds: string[];
  difficulty?: QuestionDifficulty;
  sourceType: QuestionSourceType;
  origin: ContentOrigin;
  contentStatus: ContentStatus;
  reviewedAt?: number;
  reviewedBy?: string;
  sourceIds?: string[];
  createdAt: number;
  updatedAt: number;
};

export type Attempt = {
  id: string;
  questionId: string;
  userAnswer: string;
  workingText?: string;
  score?: number;
  maxScore?: number;
  isCorrect: boolean;
  confidence: 1 | 2 | 3 | 4 | 5;
  timeSpentSeconds?: number;
  hintsUsed?: number;
  tutorUsed: boolean;
  mistakeLabels: string[];
  createdAt: number;
};

export const MAX_QUESTION_TEXT_LENGTH = 4_000;
export const MAX_ATTEMPT_ANSWER_LENGTH = 8_000;
export const MAX_MISTAKE_LABELS = 8;
export const MAX_QUESTION_FOLDER_IDS = 12;

export function isQuestionDifficulty(value: unknown): value is QuestionDifficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

export function isQuestionSourceType(value: unknown): value is QuestionSourceType {
  return value === "manual" || value === "ai-generated" || value === "imported" || value === "past-paper";
}

export function normalizeConfidence(value: unknown): Attempt["confidence"] {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  const rounded = Math.round(value);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as Attempt["confidence"];
}

export function mapQuestionData(id: string, data: Record<string, unknown>): Question {
  const questionText = normalizeOptionalString(data.questionText, MAX_QUESTION_TEXT_LENGTH) ?? "";

  return {
    id,
    questionText,
    answerText: normalizeOptionalString(data.answerText, MAX_QUESTION_TEXT_LENGTH),
    solutionText: normalizeOptionalString(data.solutionText, 8_000),
    markScheme: normalizeOptionalString(data.markScheme, 8_000),
    folderIds: normalizeStringArray(data.folderIds, MAX_QUESTION_FOLDER_IDS, 160),
    topicIds: normalizeStringArray(data.topicIds, 20, 120),
    difficulty: isQuestionDifficulty(data.difficulty) ? data.difficulty : undefined,
    sourceType: isQuestionSourceType(data.sourceType) ? data.sourceType : "manual",
    origin: isContentOrigin(data.origin) ? data.origin : "user-authored",
    contentStatus: isContentStatus(data.contentStatus) ? data.contentStatus : "approved",
    reviewedAt: typeof data.reviewedAt === "number" ? data.reviewedAt : undefined,
    reviewedBy: typeof data.reviewedBy === "string" ? data.reviewedBy : undefined,
    sourceIds: normalizeStringArray(data.sourceIds, 20, 160),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function mapAttemptData(id: string, data: Record<string, unknown>): Attempt {
  const score = typeof data.score === "number" && Number.isFinite(data.score) ? data.score : undefined;
  const maxScore =
    typeof data.maxScore === "number" && Number.isFinite(data.maxScore) ? data.maxScore : undefined;

  return {
    id,
    questionId: typeof data.questionId === "string" ? data.questionId : "",
    userAnswer: normalizeOptionalString(data.userAnswer, MAX_ATTEMPT_ANSWER_LENGTH) ?? "",
    workingText: normalizeOptionalString(data.workingText, MAX_ATTEMPT_ANSWER_LENGTH),
    score,
    maxScore,
    isCorrect: data.isCorrect === true,
    confidence: normalizeConfidence(data.confidence),
    timeSpentSeconds:
      typeof data.timeSpentSeconds === "number" && Number.isFinite(data.timeSpentSeconds)
        ? Math.max(0, Math.round(data.timeSpentSeconds))
        : undefined,
    hintsUsed:
      typeof data.hintsUsed === "number" && Number.isFinite(data.hintsUsed)
        ? Math.max(0, Math.round(data.hintsUsed))
        : undefined,
    tutorUsed: data.tutorUsed === true,
    mistakeLabels: normalizeStringArray(data.mistakeLabels, MAX_MISTAKE_LABELS, 80),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
  };
}
