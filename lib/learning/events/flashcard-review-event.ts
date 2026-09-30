import { isValidEvidenceTime } from "@/lib/learning/evidence-time";
import type { OfflineQueuedReview } from "@/lib/study/offline-study";
import type { CardRating } from "@/lib/study/scheduler";

/**
 * One flashcard answer, recorded for the Learning Engine.
 *
 * Cards keep only running scheduling totals, which say how often a card was
 * forgotten but not when -- so no trend can be read from them. These events
 * are the dated history. They are deliberately tiny: ids, a time, the result.
 * No card text, no response text, nothing the engine does not score.
 *
 * Append-only and never backfilled. History from before recording began is
 * not reconstructed from the totals; those cards keep being read from their
 * aggregate state until they have events of their own.
 */

export const FLASHCARD_REVIEW_EVENT_SCHEMA_VERSION = 1;
export const FLASHCARD_REVIEW_EVENTS_COLLECTION = "flashcardReviewEvents";

const MAX_ID_LENGTH = 160;
const STUDY_DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CARD_RATINGS: readonly CardRating[] = ["again", "hard", "good", "easy"];

export type FlashcardReviewEvent = {
  id: string;
  cardId: string;
  deckId: string;
  reviewedAt: number;
  /** The student's own study day, so repeat reviews within one day can be told apart. */
  studyDayKey: string;
  /** The app's own definition: "good" or "easy", or a correct simple-study answer. */
  correct: boolean;
  /** Absent for simple study, which has a right/wrong result and no rating. */
  rating?: CardRating;
  /**
   * The recommendation that opened the session this answer was given in.
   *
   * Absent for ordinary study, which is most of it. Present, it is what lets
   * the engine ask the only question that matters about its own advice: of the
   * evidence that arrived after a student acted, which of it arrived *because*
   * they acted.
   */
  interventionId?: string;
};

export type FlashcardReviewEventWrite = Omit<FlashcardReviewEvent, "id"> & {
  schemaVersion: typeof FLASHCARD_REVIEW_EVENT_SCHEMA_VERSION;
  createdAt: number;
};

function readId(value: unknown, maxLength = MAX_ID_LENGTH) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return id.length > 0 && id.length <= maxLength && !id.includes("/") ? id : "";
}

function isCardRating(value: unknown): value is CardRating {
  return CARD_RATINGS.some((rating) => rating === value);
}

/**
 * The answer's own commit id, which the study flow already uses to make every
 * write for one answer idempotent. Reusing it means a retried sync finds the
 * event it already wrote instead of recording the answer twice.
 */
export function flashcardReviewEventId(review: Pick<OfflineQueuedReview, "commitId" | "id">) {
  return readId(review.commitId) || readId(review.id) || null;
}

export function buildFlashcardReviewEventWrite(
  review: Pick<
    OfflineQueuedReview,
    | "cardId"
    | "deckId"
    | "reviewedAt"
    | "studyDayKey"
    | "isCorrect"
    | "rating"
    | "sessionKind"
    | "interventionId"
  >,
  createdAt: number
): FlashcardReviewEventWrite | null {
  const cardId = readId(review.cardId);
  const deckId = readId(review.deckId);
  if (
    !cardId ||
    !deckId ||
    !isValidEvidenceTime(review.reviewedAt) ||
    !STUDY_DAY_KEY_PATTERN.test(review.studyDayKey)
  ) {
    return null;
  }
  return {
    schemaVersion: FLASHCARD_REVIEW_EVENT_SCHEMA_VERSION,
    cardId,
    deckId,
    reviewedAt: review.reviewedAt,
    studyDayKey: review.studyDayKey,
    correct: review.isCorrect === true,
    ...(review.sessionKind !== "simple" && isCardRating(review.rating)
      ? { rating: review.rating }
      : {}),
    ...(readId(review.interventionId) ? { interventionId: readId(review.interventionId) } : {}),
    createdAt,
  };
}

/**
 * A stored event, or null for anything that is not a well-formed version-1
 * event. An unknown future schema is skipped rather than guessed at.
 */
export function decodeFlashcardReviewEvent(
  id: string,
  data: Record<string, unknown>
): FlashcardReviewEvent | null {
  const cardId = readId(data.cardId);
  const deckId = readId(data.deckId);
  const studyDayKey = typeof data.studyDayKey === "string" ? data.studyDayKey : "";
  if (
    !readId(id) ||
    data.schemaVersion !== FLASHCARD_REVIEW_EVENT_SCHEMA_VERSION ||
    !cardId ||
    !deckId ||
    !isValidEvidenceTime(data.reviewedAt) ||
    !STUDY_DAY_KEY_PATTERN.test(studyDayKey) ||
    typeof data.correct !== "boolean" ||
    (data.rating !== undefined && !isCardRating(data.rating))
  ) {
    return null;
  }
  const interventionId = readId(data.interventionId, 400);
  return {
    id,
    cardId,
    deckId,
    reviewedAt: data.reviewedAt,
    studyDayKey,
    correct: data.correct,
    ...(isCardRating(data.rating) ? { rating: data.rating } : {}),
    ...(interventionId ? { interventionId } : {}),
  };
}

/**
 * The credit one review earns.
 *
 * "Hard" is the one judgement call: the app counts it as a struggle, the
 * scheduler counts it as a successful recall. It earns half, which keeps a
 * student who honestly rates "hard" from reading as someone who forgot.
 */
export function flashcardReviewEventScore(event: Pick<FlashcardReviewEvent, "correct" | "rating">) {
  if (event.correct) return 1;
  return event.rating === "hard" ? 0.5 : 0;
}
