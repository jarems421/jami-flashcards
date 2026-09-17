import { planScopeKey, type RevisionPlanScope } from "@/lib/planning/types";
import { getStudyDayKey } from "@/lib/study/day";

/**
 * How much study a plan can honestly say it saw, per subject, on one day.
 *
 * A slot ticking itself is the whole reason the plan is worth keeping open: a
 * student who has done the work should never also have to say so. But the tick
 * has to mean something, so it is counted from work the app actually recorded
 * -- a card's own `lastReview`, mapped to the deck it belongs to and through
 * that deck's folders to the subjects the plan covers.
 *
 * What this deliberately does not do is guess. Revision done on paper, in a
 * notebook Jami never saw, or in another app leaves no record here, and that is
 * what the manual tick is for. An auto-tick that inferred effort would be worse
 * than no auto-tick, because the student could not tell which kind they were
 * looking at.
 *
 * None of this is evidence about learning. That a card was reviewed today is
 * already known to the learner profile, far more precisely, from the answer
 * itself. This only counts sessions so a row can be crossed off.
 */

export type PlanActivityCard = {
  deckId: string;
  lastReview?: number;
};

export type PlanActivityDeck = {
  id: string;
  folderIds?: string[];
};

/**
 * How many pieces of work landed in each scope today.
 *
 * Counted in sessions rather than in cards: forty cards in one sitting is one
 * session's worth of Biology, not forty slots' worth, and a plan that crossed
 * off a whole week because somebody had a long evening would be lying about
 * the week.
 */
export const REVIEWS_PER_PLAN_SESSION = 10;

export function buildPlanActivityByScope(input: {
  scopes: readonly RevisionPlanScope[];
  cards: readonly PlanActivityCard[];
  decks: readonly PlanActivityDeck[];
  dayKey?: string;
  now?: number;
}): Map<string, number> {
  const dayKey = input.dayKey ?? getStudyDayKey(input.now ?? Date.now());
  const wanted = new Set(input.scopes.map(planScopeKey));
  const byScope = new Map<string, number>();
  if (wanted.size === 0) return byScope;

  const foldersOfDeck = new Map<string, string[]>(
    input.decks.map((deck) => [deck.id, deck.folderIds ?? []])
  );

  const reviewsByScope = new Map<string, number>();
  for (const card of input.cards) {
    if (typeof card.lastReview !== "number") continue;
    if (getStudyDayKey(card.lastReview) !== dayKey) continue;

    /*
     * A deck in two folders counts for both.
     *
     * The alternative is to pick one, and there is no honest way to: the
     * student reviewed a Spanish card that sits in both "Spanish" and "Year
     * 11", and both of those subjects genuinely saw work. Counting it twice
     * can only ever cross off a row the student did earn.
     */
    const deckScope = `deck:${card.deckId}`;
    if (wanted.has(deckScope)) {
      reviewsByScope.set(deckScope, (reviewsByScope.get(deckScope) ?? 0) + 1);
    }
    for (const folderId of foldersOfDeck.get(card.deckId) ?? []) {
      const folderScope = `folder:${folderId}`;
      if (!wanted.has(folderScope)) continue;
      reviewsByScope.set(folderScope, (reviewsByScope.get(folderScope) ?? 0) + 1);
    }
  }

  for (const [scopeKey, reviews] of reviewsByScope) {
    // Any recorded work at all is one session; the rest scale from there.
    byScope.set(scopeKey, Math.max(1, Math.round(reviews / REVIEWS_PER_PLAN_SESSION)));
  }
  return byScope;
}
