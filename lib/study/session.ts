import type { Card } from "@/lib/study/cards";
import { getTagKey } from "@/lib/study/cards";
import type { DailyReviewState } from "@/lib/study/daily-review";
import { getStudyDayKey } from "@/lib/study/day";
import type { CardRating } from "@/lib/study/scheduler";

export type StudySessionKind = "daily-required" | "daily-optional" | "custom";
export type StudySessionStatus = "active" | "ended" | "completed";
export type StudySessionEndReason = "user-ended" | "completed" | "expired";

export type StudySessionStats = {
  reviewedCards: number;
  correctAnswers: number;
  completedGoals: number;
  starsEarned: number;
  ratings: Record<CardRating, number>;
};

export type PersistedStudySession = {
  version: 1;
  userId: string;
  studyDayKey: string;
  kind: StudySessionKind;
  status: StudySessionStatus;
  cardIds: string[];
  index: number;
  stats: StudySessionStats;
  selectedDeckIds: string[];
  selectedTags: string[];
  startedAt: number;
  savedAt: number;
  endedAt?: number;
  endReason?: StudySessionEndReason;
};

export const ACTIVE_STUDY_SESSION_DOC_ID = "activeSession";
export const ACTIVE_STUDY_SESSION_PREFIX = "jami:active-study-session:";
export const ACTIVE_STUDY_SESSION_VERSION = 1;
export const ACTIVE_STUDY_SESSION_MAX_AGE_MS = 30 * 60 * 60 * 1000;

export function createEmptySessionStats(): StudySessionStats {
  return {
    reviewedCards: 0,
    correctAnswers: 0,
    completedGoals: 0,
    starsEarned: 0,
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
  };
}

function normalizeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
        .map((entry) => entry.trim())
    )
  );
}

export function normalizeSessionStats(value: unknown): StudySessionStats {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createEmptySessionStats();
  }

  const data = value as Record<string, unknown>;
  const ratings =
    data.ratings && typeof data.ratings === "object" && !Array.isArray(data.ratings)
      ? (data.ratings as Record<string, unknown>)
      : {};

  return {
    reviewedCards: normalizeCount(data.reviewedCards),
    correctAnswers: normalizeCount(data.correctAnswers),
    completedGoals: normalizeCount(data.completedGoals),
    starsEarned: normalizeCount(data.starsEarned),
    ratings: {
      again: normalizeCount(ratings.again),
      hard: normalizeCount(ratings.hard),
      good: normalizeCount(ratings.good),
      easy: normalizeCount(ratings.easy),
    },
  };
}

export function getActiveStudySessionKey(userId: string) {
  return `${ACTIVE_STUDY_SESSION_PREFIX}${userId}`;
}

export function isSessionKind(value: unknown): value is StudySessionKind {
  return value === "daily-required" || value === "daily-optional" || value === "custom";
}

export function isSessionStatus(value: unknown): value is StudySessionStatus {
  return value === "active" || value === "ended" || value === "completed";
}

export function normalizePersistedStudySession(
  value: unknown,
  userId: string,
  currentStudyDayKey: string,
  now = Date.now()
): PersistedStudySession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const savedAt = normalizeCount(data.savedAt);
  const startedAt = normalizeCount(data.startedAt) || savedAt;
  const cardIds = normalizeStringList(data.cardIds);
  const status = isSessionStatus(data.status) ? data.status : "active";

  if (
    data.version !== ACTIVE_STUDY_SESSION_VERSION ||
    data.userId !== userId ||
    data.studyDayKey !== currentStudyDayKey ||
    !isSessionKind(data.kind) ||
    status !== "active" ||
    cardIds.length === 0 ||
    now - savedAt > ACTIVE_STUDY_SESSION_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    version: ACTIVE_STUDY_SESSION_VERSION,
    userId,
    studyDayKey: currentStudyDayKey,
    kind: data.kind,
    status,
    cardIds,
    index: Math.min(normalizeCount(data.index), cardIds.length),
    stats: normalizeSessionStats(data.stats),
    selectedDeckIds: normalizeStringList(data.selectedDeckIds),
    selectedTags: normalizeStringList(data.selectedTags),
    startedAt,
    savedAt,
  };
}

export function loadPersistedStudySession(userId: string, currentStudyDayKey: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(getActiveStudySessionKey(userId));
    return stored
      ? normalizePersistedStudySession(JSON.parse(stored), userId, currentStudyDayKey)
      : null;
  } catch (error) {
    console.warn("Failed to load active study session.", error);
    return null;
  }
}

export function savePersistedStudySession(session: PersistedStudySession) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getActiveStudySessionKey(session.userId), JSON.stringify(session));
  } catch (error) {
    console.warn("Failed to save active study session.", error);
  }
}

export function clearPersistedStudySession(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(getActiveStudySessionKey(userId));
  } catch (error) {
    console.warn("Failed to clear active study session.", error);
  }
}

export function sameSelection(left: string[], right: string[], getKey = (value: string) => value) {
  if (left.length !== right.length) {
    return false;
  }

  const rightKeys = new Set(right.map(getKey));
  return left.every((value) => rightKeys.has(getKey(value)));
}

export function canRestorePersistedSession(
  session: PersistedStudySession,
  requestedMode: "custom" | "daily" | null,
  requestedDeckIds: string[],
  requestedTags: string[]
) {
  if (requestedMode === "daily") {
    return session.kind !== "custom";
  }

  if (requestedMode !== "custom") {
    return true;
  }

  if (session.kind !== "custom") {
    return false;
  }

  if (requestedDeckIds.length === 0 && requestedTags.length === 0) {
    return true;
  }

  return (
    sameSelection(session.selectedDeckIds, requestedDeckIds) &&
    sameSelection(session.selectedTags, requestedTags, getTagKey)
  );
}

export function isDailySessionCardComplete(
  kind: StudySessionKind,
  cardId: string,
  dailyReviewState: DailyReviewState | null
) {
  if (!dailyReviewState) {
    return false;
  }

  if (kind === "daily-required") {
    return (
      dailyReviewState.completedRequiredCardIds.includes(cardId) ||
      dailyReviewState.parkedRequiredCardIds.includes(cardId)
    );
  }

  if (kind === "daily-optional") {
    return dailyReviewState.completedOptionalCardIds.includes(cardId);
  }

  return false;
}

export function hydratePersistedSessionCards(
  session: PersistedStudySession,
  cards: Card[],
  dailyReviewState: DailyReviewState | null
) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const cappedIndex = Math.min(session.index, session.cardIds.length);
  let missingBeforeIndex = 0;
  const restoredCards: Card[] = [];

  session.cardIds.forEach((cardId, position) => {
    const card = cardsById.get(cardId);
    if (!card) {
      if (position < cappedIndex) {
        missingBeforeIndex += 1;
      }
      return;
    }

    if (
      position >= cappedIndex &&
      isDailySessionCardComplete(session.kind, cardId, dailyReviewState)
    ) {
      return;
    }

    restoredCards.push(card);
  });

  return {
    cards: restoredCards,
    index: Math.max(0, Math.min(cappedIndex - missingBeforeIndex, restoredCards.length)),
  };
}

export function buildPersistedStudySession({
  userId,
  kind,
  sessionCards,
  index,
  stats,
  selectedDeckIds,
  selectedTags,
  startedAt,
  now = Date.now(),
}: {
  userId: string;
  kind: StudySessionKind;
  sessionCards: Card[];
  index: number;
  stats: StudySessionStats;
  selectedDeckIds: string[];
  selectedTags: string[];
  startedAt?: number | null;
  now?: number;
}): PersistedStudySession {
  return {
    version: ACTIVE_STUDY_SESSION_VERSION,
    userId,
    studyDayKey: getStudyDayKey(now),
    kind,
    status: "active",
    cardIds: sessionCards.map((card) => card.id),
    index: Math.max(0, Math.min(index, sessionCards.length)),
    stats,
    selectedDeckIds,
    selectedTags,
    startedAt: startedAt ?? now,
    savedAt: now,
  };
}

export function closePersistedStudySession(
  session: PersistedStudySession,
  status: Exclude<StudySessionStatus, "active">,
  reason: StudySessionEndReason,
  now = Date.now()
): PersistedStudySession {
  return {
    ...session,
    status,
    endReason: reason,
    endedAt: now,
    savedAt: now,
  };
}
