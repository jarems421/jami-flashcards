import { longestCopiedRun } from "@/lib/ai/source-evidence";

/**
 * Flashcards Tutor suggests in a conversation.
 *
 * A suggestion is only ever an offer. Nothing joins a deck from here: a saved
 * suggestion becomes a draft in its source's review queue, exactly like a
 * draft made from the source directly, and the student approves it there.
 */

export const MAX_TUTOR_CARD_SUGGESTIONS = 8;
export const MAX_TUTOR_CARD_FRONT_LENGTH = 300;
export const MAX_TUTOR_CARD_BACK_LENGTH = 1_000;

/**
 * The longest run of words a card may share with its source.
 *
 * A card that reproduces a source sentence tests whether the student can
 * recognise that sentence, not whether they understand it. Twelve words lets
 * a precise definition keep its key phrase and stops a lifted sentence.
 */
export const MAX_CARD_COPIED_RUN_WORDS = 12;

export type TutorCardSuggestion = {
  front: string;
  back: string;
  /** The S-reference the card draws on most. */
  sourceRef: string;
};

export type JamiAssistantSuggestedCard = {
  front: string;
  back: string;
  sourceId: string;
  sourceTitle: string;
  topicIds: string[];
};

const CARD_REQUEST_PATTERN =
  /\b(?:flash ?cards?|anki|revision cards?|(?:make|create|write|draft|generate|suggest|give)(?: me)?(?: some| a few| \d+)? cards?|cards? (?:on|for|about|from|covering)|memori[sz]e|help me (?:remember|learn) (?:this|these|it))\b/i;

/**
 * Whether this turn may carry card suggestions.
 *
 * Decided before the model is asked, like marking, so an ordinary question is
 * never answered with a stack of cards nobody asked for. Cards need a source to
 * be saved against, because review happens per source.
 */
export function invitesTutorCardSuggestions(input: {
  message: string;
  readableSourceCount: number;
}) {
  return input.readableSourceCount > 0 && CARD_REQUEST_PATTERN.test(input.message);
}

export const TUTOR_CARD_INSTRUCTION = [
  "The student wants flashcards. Put them in the \"cards\" field, three to six unless they asked",
  "for a number, never more than eight. Each card tests one idea. The front is a question or",
  "prompt that makes the student retrieve or apply the idea -- why, how, what happens when,",
  "compare -- rather than a sentence with a word missing. The back is the shortest complete",
  "answer, in your own words. Never copy a sentence from a source onto a card; a card that only",
  "tests whether a sentence looks familiar is a bad card. Use each source's own notation and",
  "terms. Set each card's sourceRef to the S-reference it draws on most. In the answer, say in",
  "a sentence or two what the cards cover and why those ideas; do not repeat the cards there.",
].join(" ");

function normalizeCardText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().replace(/\s+\n/g, "\n").slice(0, maxLength) : "";
}

/**
 * The model's cards, kept only where they are usable.
 *
 * A card with a missing side, a reference to a source this request never read,
 * a duplicate front, or a side lifted from its source is dropped rather than
 * repaired: a suggestion the student would have to fix is not worth offering.
 */
export function readTutorCardSuggestions(
  value: unknown,
  input: {
    allowedSourceRefs: readonly string[];
    evidenceBySourceRef?: ReadonlyMap<string, readonly string[]>;
  }
): TutorCardSuggestion[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(input.allowedSourceRefs);
  const fronts = new Set<string>();
  const cards: TutorCardSuggestion[] = [];
  for (const candidate of value) {
    if (cards.length >= MAX_TUTOR_CARD_SUGGESTIONS) break;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const front = normalizeCardText(item.front, MAX_TUTOR_CARD_FRONT_LENGTH);
    const back = normalizeCardText(item.back, MAX_TUTOR_CARD_BACK_LENGTH);
    const sourceRef = typeof item.sourceRef === "string" ? item.sourceRef.trim() : "";
    if (!front || !back || !allowed.has(sourceRef)) continue;
    const key = front.toLowerCase().replace(/\s+/g, " ");
    if (fronts.has(key)) continue;
    const evidence = input.evidenceBySourceRef?.get(sourceRef) ?? [];
    if (
      evidence.length > 0 &&
      longestCopiedRun(`${front}\n${back}`, evidence) > MAX_CARD_COPIED_RUN_WORDS
    ) {
      continue;
    }
    fronts.add(key);
    cards.push({ front, back, sourceRef });
  }
  return cards;
}

/** Suggested cards read back from a response or a saved message. */
export function normalizeSuggestedCards(value: unknown): JamiAssistantSuggestedCard[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const item = candidate as Record<string, unknown>;
      const front = normalizeCardText(item.front, MAX_TUTOR_CARD_FRONT_LENGTH);
      const back = normalizeCardText(item.back, MAX_TUTOR_CARD_BACK_LENGTH);
      const sourceId = typeof item.sourceId === "string" ? item.sourceId.trim().slice(0, 160) : "";
      const sourceTitle =
        typeof item.sourceTitle === "string" ? item.sourceTitle.trim().slice(0, 160) : "";
      if (!front || !back || !sourceId) return [];
      const topicIds = Array.isArray(item.topicIds)
        ? Array.from(
            new Set(
              item.topicIds
                .filter((id): id is string => typeof id === "string")
                .map((id) => id.trim().slice(0, 120))
                .filter(Boolean)
            )
          ).slice(0, 20)
        : [];
      return [{ front, back, sourceId, sourceTitle: sourceTitle || "Source", topicIds }];
    })
    .slice(0, MAX_TUTOR_CARD_SUGGESTIONS);
}
