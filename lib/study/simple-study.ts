import type { Card } from "@/lib/study/cards";

export type SimpleStudyQueue = {
  cards: Card[];
  newCount: number;
  wrongCount: number;
};

export type SimpleStudyResult = "correct" | "wrong";

function positiveNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function hasPriorCardRating(card: Card) {
  return Boolean(
    positiveNumber(card.lastReview) ||
      positiveNumber(card.reps) ||
      positiveNumber(card.repetitions)
  );
}

function getSeededWrongScore(card: Card) {
  const simpleWrongScore = positiveNumber(card.simpleStudyWrongCount) * 1000;
  const lapseScore = positiveNumber(card.lapses) * 120;
  const customStruggleScore = positiveNumber(card.customStruggleCount) * 80;
  const difficultyScore = positiveNumber(card.difficulty) >= 5.1 ? positiveNumber(card.difficulty) * 20 : 0;
  const struggleScore = positiveNumber(card.lastStruggleAt) > 0 ? 50 : 0;

  return simpleWrongScore + lapseScore + customStruggleScore + difficultyScore + struggleScore;
}

function isSimpleStudyCleared(card: Card) {
  if (card.simpleStudyLastResult !== "correct") {
    return false;
  }

  return positiveNumber(card.simpleStudyLastReviewedAt) >= positiveNumber(card.lastStruggleAt);
}

function isSimpleStudyNew(card: Card) {
  return !isSimpleStudyCleared(card) && !hasPriorCardRating(card) && card.simpleStudyLastResult !== "wrong";
}

function isSimpleStudyWrong(card: Card) {
  return !isSimpleStudyCleared(card) && (card.simpleStudyLastResult === "wrong" || getSeededWrongScore(card) > 0);
}

export function buildSimpleStudyQueue(cards: Card[]): SimpleStudyQueue {
  const newCards = cards
    .filter(isSimpleStudyNew)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  const wrongCards = cards
    .filter(isSimpleStudyWrong)
    .sort((left, right) => {
      const scoreDelta = getSeededWrongScore(right) - getSeededWrongScore(left);
      if (scoreDelta !== 0) return scoreDelta;

      const reviewedDelta =
        positiveNumber(right.simpleStudyLastReviewedAt) - positiveNumber(left.simpleStudyLastReviewedAt);
      if (reviewedDelta !== 0) return reviewedDelta;

      const struggleDelta = positiveNumber(right.lastStruggleAt) - positiveNumber(left.lastStruggleAt);
      if (struggleDelta !== 0) return struggleDelta;

      return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
    });

  return {
    cards: [...newCards, ...wrongCards],
    newCount: newCards.length,
    wrongCount: wrongCards.length,
  };
}

export function applySimpleStudyResultToCard(
  card: Card,
  result: SimpleStudyResult,
  reviewedAt: number
): Card {
  return {
    ...card,
    simpleStudyWrongCount:
      result === "wrong"
        ? (card.simpleStudyWrongCount ?? 0) + 1
        : card.simpleStudyWrongCount,
    simpleStudyCorrectCount:
      result === "correct"
        ? (card.simpleStudyCorrectCount ?? 0) + 1
        : card.simpleStudyCorrectCount,
    simpleStudyLastResult: result,
    simpleStudyLastReviewedAt: reviewedAt,
  };
}

export function applySimpleStudyResultToQueue(
  cards: Card[],
  cardId: string,
  result: SimpleStudyResult,
  reviewedAt: number
) {
  const currentIndex = cards.findIndex((card) => card.id === cardId);
  if (currentIndex === -1) {
    return cards;
  }

  const nextCard = applySimpleStudyResultToCard(cards[currentIndex], result, reviewedAt);
  const before = cards.slice(0, currentIndex);
  const after = cards.slice(currentIndex + 1);

  return result === "correct" ? [...before, ...after] : [...before, ...after, nextCard];
}
