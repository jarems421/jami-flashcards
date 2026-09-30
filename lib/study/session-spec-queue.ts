import { cardRetrievability } from "@/lib/learning/scoring/memory-model";
import { sortCardsByStudyPriority } from "@/lib/study/daily-review";
import type { StudySessionEmphasis } from "@/lib/learning/actions/session-spec";
import type { Card } from "@/lib/study/cards";

/**
 * Shaping a study queue to what the engine actually asked for.
 *
 * Until now a recommendation ended at a link. Today said "check Osmosis --
 * there is not enough evidence yet", the student followed it, and the session
 * that opened was the ordinary scheduler queue for that topic: due cards
 * first, everything included, no end in sight. The engine named the work and
 * then had no say in what the work was.
 *
 * This is where the spec is honoured. It does not replace the scheduler -- the
 * scheduler still decides what is due and how a card's memory is modelled, and
 * this reads that model rather than second-guessing it. It decides *which* of
 * the eligible cards this particular intent wants, and *how many*, which are
 * exactly the two questions "practise Osmosis" leaves open.
 *
 * The orderings below are the policy, one per emphasis, and each is chosen for
 * the question the session is meant to answer:
 *
 * - **diagnose** wants breadth, not depth. A diagnosis is asking "what does
 *   this student actually know here", so it spreads across as many distinct
 *   cards as it can and prefers the ones with the least history -- answering
 *   the same well-known card five times settles nothing. This is the one
 *   emphasis that deliberately *avoids* the scheduler's usual ordering.
 * - **retrieve** is the scheduler's own queue, narrowed to what is genuinely
 *   due and capped so it can be finished.
 * - **teach** and **practise** want the weakest material first: lowest
 *   predicted recall, most lapses.
 * - **reinforce** wants the cards that have just started going right, to make
 *   a recent gain stick.
 *
 * Every ordering is deterministic. The same cards and the same spec give the
 * same session, so a student who reloads gets what they had rather than a
 * reshuffle.
 */

/** A session no one finishes teaches the engine nothing, so the cap is real. */
export type StudySessionShape = {
  emphasis: StudySessionEmphasis;
  targetItems: number;
};

function lastReviewOf(card: Card) {
  return typeof card.lastReview === "number" ? card.lastReview : undefined;
}

/**
 * How likely this card is to be recalled, lowest first.
 *
 * Uses the scheduler's own fitted memory where there is one. A card it has
 * never modelled is treated as the most fragile thing in the deck, which is
 * true: nothing is known about it at all.
 */
function predictedRecall(card: Card, now: number) {
  const lastReview = lastReviewOf(card);
  const recall =
    lastReview === undefined
      ? null
      : cardRetrievability({ stability: card.stability, lastReview }, now);
  return recall ?? 0;
}

function neverReviewed(card: Card) {
  return (card.reps ?? 0) === 0;
}

function isDue(card: Card, now: number) {
  return typeof card.dueDate === "number" ? card.dueDate <= now : true;
}

/** Stable tiebreak, so one ordering is one ordering. */
function byId(left: Card, right: Card) {
  return left.id.localeCompare(right.id);
}

function orderForEmphasis(cards: Card[], emphasis: StudySessionEmphasis, now: number) {
  const ordered = [...cards];
  switch (emphasis) {
    case "diagnose":
      /*
       * Least-known first, and never the same card twice.
       *
       * A diagnosis is sized to reach a confidence threshold, and confidence
       * comes from breadth: the engine's own scoring caps how much one item
       * can ever say about a topic. A queue that opened with the five cards
       * the student has answered most would spend the whole session gathering
       * evidence the model has already discounted.
       */
      return ordered.sort(
        (left, right) =>
          Number(neverReviewed(right)) - Number(neverReviewed(left)) ||
          (left.reps ?? 0) - (right.reps ?? 0) ||
          predictedRecall(left, now) - predictedRecall(right, now) ||
          byId(left, right)
      );
    case "retrieve":
      // What the scheduler says is due, soonest first; the rest only as filler.
      return ordered.sort(
        (left, right) =>
          Number(isDue(right, now)) - Number(isDue(left, now)) ||
          (left.dueDate ?? Number.POSITIVE_INFINITY) - (right.dueDate ?? Number.POSITIVE_INFINITY) ||
          byId(left, right)
      );
    case "reinforce":
      /*
       * Recently practised and now holding: the gain worth locking in. A card
       * never reviewed has no gain to reinforce, so it goes last.
       */
      return ordered.sort(
        (left, right) =>
          Number(neverReviewed(left)) - Number(neverReviewed(right)) ||
          (lastReviewOf(right) ?? 0) - (lastReviewOf(left) ?? 0) ||
          byId(left, right)
      );
    case "teach":
    case "practise":
    default:
      // The weakest material first, by the scheduler's own model of it.
      return ordered.sort(
        (left, right) =>
          predictedRecall(left, now) - predictedRecall(right, now) ||
          (right.lapses ?? 0) - (left.lapses ?? 0) ||
          byId(left, right)
      );
  }
}

/**
 * The cards this session should actually ask, in the order it should ask them.
 *
 * With no shape, the caller's existing queue is returned untouched: a student
 * who opened Learn themselves is not carrying out anybody's recommendation,
 * and the ordinary scheduler ordering is the right answer for them.
 *
 * A shape whose ordering would leave the session empty falls back to the
 * scheduler's ordering rather than to nothing. Opening a session with no cards
 * because a policy was too fussy is worse than opening the ordinary one.
 */
export function applyStudySessionShape(
  cards: readonly Card[],
  shape: StudySessionShape | null,
  now = Date.now()
): Card[] {
  if (!shape) return [...cards];
  const limit = Math.max(1, Math.round(shape.targetItems));
  const ordered = orderForEmphasis([...cards], shape.emphasis, now);
  const chosen = ordered.slice(0, limit);
  return chosen.length > 0 ? chosen : sortCardsByStudyPriority([...cards], now).slice(0, limit);
}

const EMPHASES: readonly StudySessionEmphasis[] = [
  "retrieve",
  "practise",
  "teach",
  "diagnose",
  "reinforce",
];

export function isStudySessionEmphasis(value: unknown): value is StudySessionEmphasis {
  return EMPHASES.some((emphasis) => emphasis === value);
}

/** The largest session the engine may ask for, whatever a link says. */
export const MAX_SPEC_SESSION_ITEMS = 40;

/**
 * A shape read from a link, or null when there is not a usable one.
 *
 * Both parts must be present and sane. A link is student-visible and editable,
 * so the size is clamped rather than trusted: the cap exists to stop a session
 * that cannot be finished, and a hand-typed `focusCount=9999` would defeat the
 * whole point of having one.
 */
export function readStudySessionShape(
  emphasis: string | null,
  count: string | null
): StudySessionShape | null {
  if (!isStudySessionEmphasis(emphasis)) return null;
  const parsed = Number.parseInt(count ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return { emphasis, targetItems: Math.min(MAX_SPEC_SESSION_ITEMS, parsed) };
}
