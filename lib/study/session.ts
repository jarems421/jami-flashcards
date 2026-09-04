import type { Card } from "@/lib/study/cards";
import type { DailyReviewState } from "@/lib/study/daily-review-types";
import { getStudyDayKey } from "@/lib/study/day";
import type { CardRating } from "@/lib/study/scheduler";
import {
  isStudyMode,
  SMART_STUDY_MODE_POLICY,
  type StudyMode,
  type StudyModePolicy,
} from "@/lib/study/study-modes";

export type StudySessionKind = "daily-required" | "daily-optional" | "custom" | "simple";
export type StudySessionStatus = "active" | "ended" | "completed";
export type StudySessionEndReason = "user-ended" | "completed" | "expired";

export type StudySessionStats = {
  reviewedCards: number;
  correctAnswers: number;
  completedGoals: number;
  starsEarned: number;
  ratings: Record<CardRating, number>;
};

/**
 * One card's exercise, frozen into the session.
 *
 * Everything needed to redraw the question is here, including the MCQ options
 * and their order, so a resumed session never has to reach Firestore for an
 * asset that may not be cached -- and never shows a student a different set of
 * choices than the ones they were looking at.
 *
 * `contentHash` is the safety catch: if the card has been edited since, the
 * exercise is stale and must be rebuilt or dropped rather than marked against.
 */
export type PersistedStudyExercise = {
  cardId: string;
  mode: StudyMode;
  contentHash: string;
  cloze?: { start: number; end: number; answer: string };
  mcq?: {
    options: Array<{ id: string; text: string }>;
    correctOptionId: string;
    explanations?: Record<string, string>;
  };
};

export type StudyModeResults = Partial<
  Record<StudyMode, { answered: number; correct: number }>
>;

export type PersistedStudySession = {
  version: 3;
  sessionId: string;
  revision: number;
  userId: string;
  studyDayKey: string;
  kind: StudySessionKind;
  status: StudySessionStatus;
  cardIds: string[];
  index: number;
  stats: StudySessionStats;
  selectedDeckIds: string[];
  selectedTopicIds: string[];
  legacySelectedTags?: string[];
  startedAt: number;
  savedAt: number;
  endedAt?: number;
  endReason?: StudySessionEndReason;
  closedRevision?: number;
  /** How this session asks its cards. Absent on v1 and v2, which were all Classic. */
  modePolicy?: StudyModePolicy;
  /** Fixed at session start so a shuffled MCQ keeps its order across a resume. */
  seed?: number;
  exercises?: PersistedStudyExercise[];
  modeResults?: StudyModeResults;
};

export const ACTIVE_STUDY_SESSION_DOC_ID = "activeSession";
export const ACTIVE_STUDY_SESSION_PREFIX = "jami:active-study-session:";
export const CLOSED_STUDY_SESSION_PREFIX = "jami:closed-study-session:";
// Annotated rather than inferred so it does not widen to `number` when spread
// into an object literal, which would make every caller's session untypeable.
export const ACTIVE_STUDY_SESSION_VERSION: PersistedStudySession["version"] = 3;
/** Every schema this build still knows how to read. */
const READABLE_SESSION_VERSIONS = [1, 2, 3];
export const ACTIVE_STUDY_SESSION_MAX_AGE_MS = 30 * 60 * 60 * 1000;

export type ClosedStudySessionTombstone = {
  version: 3;
  userId: string;
  sessionId: string;
  revision: number;
  status: Exclude<StudySessionStatus, "active">;
  reason: StudySessionEndReason;
  savedAt: number;
  retryRemoteClose: boolean;
  session: PersistedStudySession;
};

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

export function getActiveStudySessionTombstoneKey(userId: string) {
  return `${CLOSED_STUDY_SESSION_PREFIX}${userId}`;
}

export function isSessionKind(value: unknown): value is StudySessionKind {
  return value === "daily-required" || value === "daily-optional" || value === "custom" || value === "simple";
}

export function isSessionStatus(value: unknown): value is StudySessionStatus {
  return value === "active" || value === "ended" || value === "completed";
}

function normalizeSessionId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function createLegacySessionId({
  userId,
  studyDayKey,
  kind,
  startedAt,
  cardIds,
}: {
  userId: string;
  studyDayKey: string;
  kind: StudySessionKind;
  startedAt: number;
  cardIds: string[];
}) {
  const firstCardId = cardIds[0] ?? "empty";
  return `legacy:${userId}:${studyDayKey}:${kind}:${startedAt}:${cardIds.length}:${firstCardId}`;
}

function createSessionId(userId: string, now: number) {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${userId}:${now}:${randomPart}`;
}

export function normalizeModePolicy(value: unknown): StudyModePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return SMART_STUDY_MODE_POLICY;
  }
  const data = value as Record<string, unknown>;
  if (data.kind === "fixed" && isStudyMode(data.mode)) {
    return { kind: "fixed", mode: data.mode };
  }
  return SMART_STUDY_MODE_POLICY;
}

function normalizeClozeSpan(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const start = normalizeCount(data.start);
  const end = normalizeCount(data.end);
  const answer = typeof data.answer === "string" ? data.answer : "";
  if (!answer || end <= start) return null;
  return { start, end, answer };
}

function normalizeMcqSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const rawOptions = Array.isArray(data.options) ? data.options : [];
  const options = rawOptions
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const option = entry as Record<string, unknown>;
      const id = typeof option.id === "string" ? option.id.trim() : "";
      const text = typeof option.text === "string" ? option.text : "";
      return id && text ? { id, text } : null;
    })
    .filter((option): option is { id: string; text: string } => option !== null);
  const correctOptionId =
    typeof data.correctOptionId === "string" ? data.correctOptionId : "";
  // A snapshot whose right answer is not among its choices is unusable, and
  // repairing it would mean inventing one.
  if (options.length < 2 || !options.some((option) => option.id === correctOptionId)) {
    return null;
  }
  const explanations: Record<string, string> = {};
  if (data.explanations && typeof data.explanations === "object") {
    for (const [key, text] of Object.entries(data.explanations as Record<string, unknown>)) {
      if (typeof text === "string" && text.trim()) explanations[key] = text;
    }
  }
  return { options, correctOptionId, explanations };
}

export function normalizePersistedExercises(
  value: unknown,
  cardIds: string[]
): PersistedStudyExercise[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(cardIds);
  const seen = new Set<string>();
  const exercises: PersistedStudyExercise[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const data = entry as Record<string, unknown>;
    const cardId = typeof data.cardId === "string" ? data.cardId.trim() : "";
    const contentHash =
      typeof data.contentHash === "string" ? data.contentHash.trim() : "";
    if (!cardId || !allowed.has(cardId) || seen.has(cardId)) continue;
    if (!isStudyMode(data.mode) || !contentHash) continue;

    const cloze = normalizeClozeSpan(data.cloze);
    const mcq = normalizeMcqSnapshot(data.mcq);
    // A mode whose material did not survive normalization is dropped rather
    // than downgraded, so the session rebuilds it instead of asking a
    // half-formed question.
    if (data.mode === "gap-fill" && !cloze) continue;
    if (data.mode === "multiple-choice" && !mcq) continue;

    seen.add(cardId);
    exercises.push({
      cardId,
      mode: data.mode,
      contentHash,
      ...(cloze ? { cloze } : {}),
      ...(mcq ? { mcq } : {}),
    });
  }

  return exercises;
}

export function normalizeModeResults(value: unknown): StudyModeResults {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const results: StudyModeResults = {};
  for (const [mode, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isStudyMode(mode) || !entry || typeof entry !== "object") continue;
    const data = entry as Record<string, unknown>;
    results[mode] = {
      answered: normalizeCount(data.answered),
      correct: normalizeCount(data.correct),
    };
  }
  return results;
}

function normalizeRevision(value: unknown, index: number, stats: StudySessionStats) {
  const explicitRevision = normalizeCount(value);
  if (explicitRevision > 0) {
    return explicitRevision;
  }

  return Math.max(index, stats.reviewedCards, 1);
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
  const stats = normalizeSessionStats(data.stats);
  const index = Math.min(normalizeCount(data.index), cardIds.length);
  const studyDayKey =
    typeof data.studyDayKey === "string" && data.studyDayKey.trim()
      ? data.studyDayKey
      : currentStudyDayKey;

  if (
    !READABLE_SESSION_VERSIONS.includes(data.version as number) ||
    data.userId !== userId ||
    !isSessionKind(data.kind) ||
    status !== "active" ||
    cardIds.length === 0 ||
    now - savedAt > ACTIVE_STUDY_SESSION_MAX_AGE_MS
  ) {
    return null;
  }

  const sessionId =
    normalizeSessionId(data.sessionId) ||
    createLegacySessionId({ userId, studyDayKey, kind: data.kind, startedAt, cardIds });
  const revision = normalizeRevision(data.revision, index, stats);
  const closedRevision = normalizeCount(data.closedRevision);
  const exercises = normalizePersistedExercises(data.exercises, cardIds);
  const modeResults = normalizeModeResults(data.modeResults);

  return {
    version: ACTIVE_STUDY_SESSION_VERSION,
    sessionId,
    revision,
    userId,
    studyDayKey,
    kind: data.kind,
    status,
    cardIds,
    index,
    stats,
    selectedDeckIds: normalizeStringList(data.selectedDeckIds),
    selectedTopicIds: normalizeStringList(data.selectedTopicIds),
    ...(normalizeStringList(data.selectedTags).length > 0
      ? { legacySelectedTags: normalizeStringList(data.selectedTags) }
      : {}),
    startedAt,
    savedAt,
    ...(closedRevision > 0 ? { closedRevision } : {}),
    // v1 and v2 sessions predate modes and were all Classic. Reading one back
    // as Smart Mix would silently change what a resumed session asks, so the
    // absence of a policy is preserved and the caller decides.
    ...(data.modePolicy ? { modePolicy: normalizeModePolicy(data.modePolicy) } : {}),
    ...(normalizeCount(data.seed) > 0 ? { seed: normalizeCount(data.seed) } : {}),
    ...(exercises.length > 0 ? { exercises } : {}),
    ...(Object.keys(modeResults).length > 0 ? { modeResults } : {}),
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

function normalizeTombstone(value: unknown, userId: string, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const rawSession =
    data.session && typeof data.session === "object" && !Array.isArray(data.session)
      ? (data.session as Record<string, unknown>)
      : null;
  const status = isSessionStatus(rawSession?.status) && rawSession.status !== "active" ? rawSession.status : null;
  const session = rawSession
    ? normalizePersistedStudySession({ ...rawSession, status: "active" }, userId, "", now)
    : null;
  const sessionId = normalizeSessionId(data.sessionId);
  const savedAt = normalizeCount(data.savedAt);
  const tombstoneStatus = isSessionStatus(data.status) && data.status !== "active" ? data.status : null;
  const reason =
    data.reason === "user-ended" || data.reason === "completed" || data.reason === "expired"
      ? data.reason
      : null;

  if (
    !READABLE_SESSION_VERSIONS.includes(data.version as number) ||
    !session ||
    !sessionId ||
    sessionId !== session.sessionId ||
    !status ||
    !tombstoneStatus ||
    !reason ||
    now - savedAt > ACTIVE_STUDY_SESSION_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    version: ACTIVE_STUDY_SESSION_VERSION,
    userId,
    sessionId,
    revision: Math.max(normalizeCount(data.revision), session.revision),
    status: tombstoneStatus,
    reason,
    savedAt,
    retryRemoteClose: Boolean(data.retryRemoteClose),
    session: {
      ...session,
      status,
      endReason: reason,
      endedAt: normalizeCount(rawSession?.endedAt) || savedAt,
      closedRevision: Math.max(normalizeCount(rawSession?.closedRevision), session.revision),
    },
  } satisfies ClosedStudySessionTombstone;
}

export function loadClosedStudySessionTombstone(userId: string, now = Date.now()) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const key = getActiveStudySessionTombstoneKey(userId);
    const stored = window.localStorage.getItem(key);
    const tombstone = stored ? normalizeTombstone(JSON.parse(stored), userId, now) : null;
    if (!tombstone && stored) {
      window.localStorage.removeItem(key);
    }
    return tombstone;
  } catch (error) {
    console.warn("Failed to load closed study session tombstone.", error);
    return null;
  }
}

export function saveClosedStudySessionTombstone(
  session: PersistedStudySession,
  retryRemoteClose = true,
  now = Date.now()
) {
  if (typeof window === "undefined") {
    return;
  }

  const closedSession =
    session.status === "active"
      ? closePersistedStudySession(session, "ended", "user-ended", now)
      : session;
  const tombstone: ClosedStudySessionTombstone = {
    version: ACTIVE_STUDY_SESSION_VERSION,
    userId: closedSession.userId,
    sessionId: closedSession.sessionId,
    revision: closedSession.closedRevision ?? closedSession.revision,
    status: closedSession.status === "active" ? "ended" : closedSession.status,
    reason: closedSession.endReason ?? "user-ended",
    savedAt: now,
    retryRemoteClose,
    session: closedSession,
  };

  try {
    window.localStorage.setItem(
      getActiveStudySessionTombstoneKey(closedSession.userId),
      JSON.stringify(tombstone)
    );
  } catch (error) {
    console.warn("Failed to save closed study session tombstone.", error);
  }
}

export function hasClosedStudySessionTombstone(
  userId: string,
  sessionId: string,
  revision = 0,
  now = Date.now()
) {
  const tombstone = loadClosedStudySessionTombstone(userId, now);
  return Boolean(
    tombstone &&
      tombstone.sessionId === sessionId &&
      tombstone.revision >= revision
  );
}

export function markClosedStudySessionTombstoneSynced(userId: string, now = Date.now()) {
  if (typeof window === "undefined") {
    return;
  }

  const tombstone = loadClosedStudySessionTombstone(userId, now);
  if (!tombstone) {
    return;
  }

  saveClosedStudySessionTombstone(tombstone.session, false, now);
}

export function clearClosedStudySessionTombstone(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(getActiveStudySessionTombstoneKey(userId));
  } catch (error) {
    console.warn("Failed to clear closed study session tombstone.", error);
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
  requestedTopicIds: string[]
) {
  if (requestedMode === "daily") {
    return session.kind === "daily-required" || session.kind === "daily-optional";
  }

  if (requestedMode !== "custom") {
    return true;
  }

  if (session.kind !== "custom") {
    return false;
  }

  if (requestedDeckIds.length === 0 && requestedTopicIds.length === 0) {
    return true;
  }

  return (
    sameSelection(session.selectedDeckIds, requestedDeckIds) &&
    sameSelection(session.selectedTopicIds, requestedTopicIds)
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
  sessionId,
  revision,
  studyDayKey,
  kind,
  sessionCards,
  index,
  stats,
  selectedDeckIds,
  selectedTopicIds,
  startedAt,
  now = Date.now(),
  modePolicy,
  seed,
  exercises,
  modeResults,
}: {
  userId: string;
  sessionId?: string | null;
  revision?: number | null;
  studyDayKey?: string | null;
  kind: StudySessionKind;
  sessionCards: Card[];
  index: number;
  stats: StudySessionStats;
  selectedDeckIds: string[];
  selectedTopicIds: string[];
  startedAt?: number | null;
  now?: number;
  modePolicy?: StudyModePolicy;
  seed?: number;
  exercises?: PersistedStudyExercise[];
  modeResults?: StudyModeResults;
}): PersistedStudySession {
  const nextRevision = revision && revision > 0 ? Math.floor(revision) : 1;
  return {
    version: ACTIVE_STUDY_SESSION_VERSION,
    sessionId: sessionId ?? createSessionId(userId, startedAt ?? now),
    revision: nextRevision,
    userId,
    studyDayKey: studyDayKey ?? getStudyDayKey(now),
    kind,
    status: "active",
    cardIds: sessionCards.map((card) => card.id),
    index: Math.max(0, Math.min(index, sessionCards.length)),
    stats,
    selectedDeckIds,
    selectedTopicIds,
    startedAt: startedAt ?? now,
    savedAt: now,
    ...(modePolicy ? { modePolicy } : {}),
    ...(seed ? { seed } : {}),
    ...(exercises && exercises.length > 0 ? { exercises } : {}),
    ...(modeResults && Object.keys(modeResults).length > 0 ? { modeResults } : {}),
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
    revision: session.revision + 1,
    closedRevision: session.revision + 1,
    endReason: reason,
    endedAt: now,
    savedAt: now,
  };
}

function hasSameStudySessionIdentity(
  left: PersistedStudySession,
  right: PersistedStudySession
) {
  return (
    left.userId === right.userId &&
    left.sessionId === right.sessionId
  );
}

function getStudySessionProgress(session: PersistedStudySession) {
  return {
    reviewedCards: session.stats.reviewedCards,
    index: session.index,
  };
}

export function isStudySessionProgressRegression(
  existingSession: PersistedStudySession,
  incomingSession: PersistedStudySession
) {
  if (!hasSameStudySessionIdentity(existingSession, incomingSession)) {
    return false;
  }

  const existingProgress = getStudySessionProgress(existingSession);
  const incomingProgress = getStudySessionProgress(incomingSession);

  if (existingProgress.reviewedCards !== incomingProgress.reviewedCards) {
    return existingProgress.reviewedCards > incomingProgress.reviewedCards;
  }

  return existingProgress.index > incomingProgress.index;
}

export function isIncomingSessionNewer(
  existingSession: PersistedStudySession,
  incomingSession: PersistedStudySession
) {
  if (existingSession.userId !== incomingSession.userId) {
    return false;
  }

  if (existingSession.sessionId !== incomingSession.sessionId) {
    return existingSession.startedAt < incomingSession.startedAt;
  }

  const existingClosedRevision =
    existingSession.status !== "active"
      ? existingSession.closedRevision ?? existingSession.revision
      : 0;
  const incomingClosedRevision =
    incomingSession.status !== "active"
      ? incomingSession.closedRevision ?? incomingSession.revision
      : 0;

  if (existingClosedRevision !== incomingClosedRevision) {
    return incomingClosedRevision > existingClosedRevision;
  }

  if (existingSession.status !== incomingSession.status) {
    return existingSession.status === "active" && incomingSession.status !== "active";
  }

  if (existingSession.revision !== incomingSession.revision) {
    return incomingSession.revision > existingSession.revision;
  }

  return incomingSession.savedAt > existingSession.savedAt;
}
