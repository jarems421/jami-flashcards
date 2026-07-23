export type DailyReviewState = {
  id: string;
  studyDayKey: string;
  generatedAt: number;
  requiredCardIds: string[];
  optionalCardIds: string[];
  carryoverRequiredCardIds: string[];
  completedRequiredCardIds: string[];
  completedOptionalCardIds: string[];
  parkedRequiredCardIds: string[];
  requiredRetryCounts: Record<string, number>;
  updatedAt: number;
};

export type DailyReviewStateData = Omit<DailyReviewState, "id">;
