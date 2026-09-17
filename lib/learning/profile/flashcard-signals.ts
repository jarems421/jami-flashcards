import {
  flashcardReviewEventScore,
  type FlashcardReviewEvent,
} from "@/lib/learning/events/flashcard-review-event";
import { clampUnit } from "@/lib/learning/scoring/mastery-score";
import { cardRetrievability } from "@/lib/learning/scoring/memory-model";
import { DEFAULT_LEARNING_TUNING, type LearningTuning } from "@/lib/learning/scoring/tuning";
import type { LearningObservation } from "@/lib/learning/types";
import type { Card } from "@/lib/study/cards";

export type FlashcardEvidenceCard = Pick<
  Card,
  | "id"
  | "deckId"
  | "topicIds"
  | "reps"
  | "lapses"
  | "difficulty"
  | "fsrsState"
  | "lastReview"
  | "dueDate"
> &
  Partial<Pick<Card, "createdAt">>;

/** ts-fsrs `State.Relearning`: the card's most recent review was a lapse. */
const FSRS_RELEARNING_STATE = 3;

/** Reviews before a card read from its totals counts as a full piece of evidence. */
export const FLASHCARD_REVIEWS_FOR_FULL_WEIGHT = 3;

/** A card counts towards each of its Topics, or towards its deck when it has none. */
export function flashcardTopicKeys(card: Pick<FlashcardEvidenceCard, "topicIds" | "deckId">) {
  const topicIds = card.topicIds ?? [];
  if (topicIds.length > 0) return topicIds.map((topicId) => `topic:${topicId}`);
  return card.deckId ? [`deck:${card.deckId}`] : [];
}

/**
 * How reliably a card is recalled, from the scheduling state already on it.
 *
 * The share of reviews that were not lapses, blended with FSRS difficulty
 * (which the scheduler derives from every rating given). A card currently in
 * relearning was forgotten on its last review, and is capped low whatever its
 * history says.
 */
export function flashcardRecallScore(
  card: Pick<FlashcardEvidenceCard, "reps" | "lapses" | "difficulty" | "fsrsState">,
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
) {
  const reps = Math.max(0, card.reps ?? 0);
  if (!(reps > 0)) return 0;
  let score = 1 - clampUnit(Math.max(0, card.lapses ?? 0) / reps);
  if (typeof card.difficulty === "number" && card.difficulty > 0) {
    const ease = 1 - clampUnit((card.difficulty - 1) / 9);
    score = score * tuning.flashcardLapseWeight + ease * (1 - tuning.flashcardLapseWeight);
  }
  if (card.fsrsState === FSRS_RELEARNING_STATE) {
    score = Math.min(score, tuning.flashcardRelearningCap);
  }
  return clampUnit(score);
}

function aggregateObservation(
  card: FlashcardEvidenceCard,
  now: number,
  tuning: LearningTuning
): LearningObservation[] {
  const reps = Math.max(0, Math.floor(Number.isFinite(card.reps) ? (card.reps ?? 0) : 0));
  if (reps === 0 || typeof card.lastReview !== "number") return [];
  const modelled = cardRetrievability(card, now, tuning);
  return [
    {
      kind: "flashcards",
      evidenceId: `card:${card.id}`,
      itemId: `card:${card.id}`,
      topicKeys: flashcardTopicKeys(card),
      score: modelled ?? flashcardRecallScore(card, tuning),
      weight: Math.min(1, reps / FLASHCARD_REVIEWS_FOR_FULL_WEIGHT),
      count: reps,
      at: card.lastReview,
      trendEligible: false,
      ...(modelled !== null ? { currentEstimate: true } : {}),
      errorChecks: [],
    },
  ];
}

/**
 * The first review of a card on each study day.
 *
 * The first answer after a gap is the one that tests memory. Later answers the
 * same day are relearning steps straight after being shown the card, and
 * counting them would let one stubborn card flood a topic with failures and
 * then with instant "recoveries". Ties on time break on the event id so the
 * choice never depends on read order.
 */
function firstReviewsPerDay(
  cardsById: ReadonlyMap<string, FlashcardEvidenceCard>,
  events: readonly FlashcardReviewEvent[]
) {
  const first = new Map<string, FlashcardReviewEvent>();
  for (const event of events) {
    const card = cardsById.get(event.cardId);
    // A deleted card, or an event from before a card was moved, is not evidence.
    if (!card || card.deckId !== event.deckId) continue;
    const key = `${event.cardId}|${event.studyDayKey}`;
    const existing = first.get(key);
    if (
      !existing ||
      event.reviewedAt < existing.reviewedAt ||
      (event.reviewedAt === existing.reviewedAt && event.id < existing.id)
    ) {
      first.set(key, event);
    }
  }
  return Array.from(first.values());
}

/**
 * Flashcard evidence: recorded review events where a card has them, its
 * aggregate scheduling state where it does not.
 *
 * Never both for one card. The totals already include every review an event
 * records, so mixing them would count those reviews twice. A card with events
 * is scored on its dated history, which is what makes a flashcard trend
 * possible at all; a card from before recording began keeps working exactly as
 * it did.
 */
export function flashcardObservations(
  cards: readonly FlashcardEvidenceCard[],
  events: readonly FlashcardReviewEvent[] = [],
  now: number = Date.now(),
  tuning: LearningTuning = DEFAULT_LEARNING_TUNING
): LearningObservation[] {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const dailyFirst = firstReviewsPerDay(cardsById, events);
  const eventBacked = new Set(dailyFirst.map((event) => event.cardId));

  const fromEvents = dailyFirst.flatMap((event): LearningObservation[] => {
    const card = cardsById.get(event.cardId);
    if (!card) return [];
    return [
      {
        kind: "flashcards",
        evidenceId: `event:${event.id}`,
        itemId: `card:${card.id}`,
        topicKeys: flashcardTopicKeys(card),
        score: flashcardReviewEventScore(event),
        weight: 1,
        count: 1,
        at: event.reviewedAt,
        trendEligible: true,
        errorChecks: [],
      },
    ];
  });

  return [
    ...cards.flatMap((card) =>
      eventBacked.has(card.id) ? [] : aggregateObservation(card, now, tuning)
    ),
    ...fromEvents,
  ];
}
