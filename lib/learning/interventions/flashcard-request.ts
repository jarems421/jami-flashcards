import {
  MAX_GENERATED_CARDS,
  MIN_GENERATED_CARDS,
  type GeneratedCardDraft,
} from "@/lib/ai/card-generation";
import { filterCanonicalConceptIds } from "@/lib/practice/exam-specification-concepts";

/**
 * Asking for cards on one concept, and deciding what came back is usable.
 *
 * The generator's whole job is to produce a *draft*. Nothing here writes
 * anything: the student sees what Jami wrote, edits or discards it, and only
 * then does anything reach their deck. That ordering is the point rather than
 * a courtesy -- cards are the student's own revision material, and material
 * they did not agree to is worse than no material.
 *
 * Creating cards is also not evidence about the student, however many are
 * made. Only answering them is, which is why this produces drafts and the
 * intervention stays open until reviews arrive.
 */

/** How many to ask for, before the model's own judgement narrows it. */
export const DEFAULT_REQUESTED_CARDS = 8;
/** Existing fronts sent as exclusions; enough to be useful, bounded for the prompt. */
export const MAX_EXCLUSION_FRONTS = 40;
const MAX_EXCLUSION_LENGTH = 180;

export type FlashcardInterventionRequest = {
  /** The canonical concept these cards are for. Validated, never invented. */
  conceptId: string;
  conceptLabel: string;
  /** The specification the concept belongs to, for the prompt's framing. */
  specificationId: string;
  /** Fronts the student already has, so the model can avoid repeating them. */
  existingFronts: string[];
  requestedCount: number;
  /** The recommendation that asked for these. Travels onto every card written. */
  interventionId: string;
};

export type FlashcardRequestRejection =
  | "unknown_concept"
  | "missing_intervention"
  | "no_specification";

export type FlashcardRequestResult =
  | { ok: true; request: FlashcardInterventionRequest }
  | { ok: false; reason: FlashcardRequestRejection };

function trimmed(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * A request, or the reason there isn't one.
 *
 * The concept is checked against the course's own catalogue rather than
 * trusted. Generating cards for a concept the specification has never heard of
 * would attach real material to an invented heading, and the student would
 * have no way to tell -- so an unknown id is refused rather than passed
 * through and tidied up later.
 */
export function buildFlashcardRequest(input: {
  conceptId: string;
  conceptLabel: string;
  specificationId: string;
  existingFronts?: readonly string[];
  requestedCount?: number;
  interventionId: string;
}): FlashcardRequestResult {
  const specificationId = trimmed(input.specificationId, 80);
  if (!specificationId) return { ok: false, reason: "no_specification" };

  const interventionId = trimmed(input.interventionId, 400);
  if (!interventionId) return { ok: false, reason: "missing_intervention" };

  const { conceptIds } = filterCanonicalConceptIds(specificationId, [
    trimmed(input.conceptId, 160),
  ]);
  const conceptId = conceptIds[0];
  if (!conceptId) return { ok: false, reason: "unknown_concept" };

  /*
   * What the student already has, told to the model as exclusions.
   *
   * Measured, so worth stating plainly: this does not work very well. Given
   * six cards covering a concept and asked for five more "however differently
   * worded", the model returned three that were the same questions with a word
   * inserted -- "how do you multiply numbers" became "how do you multiply two
   * numbers" -- and the filter below caught none of them.
   *
   * So this is a request, not a mechanism, and the student reading the draft
   * is what actually prevents redundant cards being added. See
   * `scripts/eval/intervention-generation-batch.ts`, case
   * `near-duplicate-pressure`.
   */
  const existingFronts = Array.from(
    new Set(
      (input.existingFronts ?? [])
        .map((front) => trimmed(front, MAX_EXCLUSION_LENGTH))
        .filter(Boolean)
    )
  ).slice(0, MAX_EXCLUSION_FRONTS);

  const requested = Math.round(input.requestedCount ?? DEFAULT_REQUESTED_CARDS);
  return {
    ok: true,
    request: {
      conceptId,
      conceptLabel: trimmed(input.conceptLabel, 200) || conceptId,
      specificationId,
      existingFronts,
      requestedCount: Math.max(MIN_GENERATED_CARDS, Math.min(MAX_GENERATED_CARDS, requested)),
      interventionId,
    },
  };
}

export type FlashcardDraftRejection = "no_usable_cards" | "all_duplicates";

export type FlashcardDraftResult =
  | { ok: true; drafts: GeneratedCardDraft[]; droppedDuplicates: number }
  | { ok: false; reason: FlashcardDraftRejection };

/**
 * A key for spotting the *same text twice*, and nothing more.
 *
 * Deliberately not called a fingerprint or a dedup key: it collapses case and
 * punctuation, so it catches a model repeating a front verbatim and misses
 * every rewording. Calling it deduplication would invite someone downstream to
 * believe redundant cards cannot get through, which is the opposite of true.
 */
function exactTextKey(front: string) {
  return front.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The drafts worth showing, or the reason there are none.
 *
 * Fails closed. A generation that returns nothing usable is a generation that
 * did not happen, and the intervention stays open rather than being marked
 * done -- Jami asking for cards and producing none is not the student having
 * been helped.
 *
 * The check here is exact-text only. It catches a front repeated verbatim and
 * nothing else -- a single inserted word defeats it, which was measured rather
 * than assumed. Everything subtler is left to the person reading the draft,
 * and that is the whole of the protection, not a backstop to it.
 */
export function readFlashcardDrafts(
  drafts: readonly GeneratedCardDraft[],
  request: Pick<FlashcardInterventionRequest, "existingFronts">
): FlashcardDraftResult {
  if (drafts.length === 0) return { ok: false, reason: "no_usable_cards" };

  const existing = new Set(request.existingFronts.map(exactTextKey));
  const seen = new Set<string>();
  const kept: GeneratedCardDraft[] = [];
  let droppedDuplicates = 0;

  for (const draft of drafts) {
    if (!draft.front.trim() || !draft.back.trim()) continue;
    const key = exactTextKey(draft.front);
    if (!key) continue;
    if (existing.has(key) || seen.has(key)) {
      droppedDuplicates += 1;
      continue;
    }
    seen.add(key);
    kept.push(draft);
  }

  if (kept.length === 0) {
    return {
      ok: false,
      reason: droppedDuplicates > 0 ? "all_duplicates" : "no_usable_cards",
    };
  }
  return { ok: true, drafts: kept, droppedDuplicates };
}

/**
 * What the model is told.
 *
 * Built here rather than in the route so the instruction and the validation
 * that judges its output sit in one file and cannot drift apart.
 */
export function flashcardGenerationPrompt(request: FlashcardInterventionRequest) {
  const exclusions =
    request.existingFronts.length > 0
      ? `\n\nThe student already has cards asking these. Do not write another card that asks the same thing, however differently worded:\n${request.existingFronts
          .map((front) => `- ${front}`)
          .join("\n")}`
      : "";
  return (
    `Write up to ${request.requestedCount} flashcards on one concept from a course specification: ` +
    `"${request.conceptLabel}".\n\n` +
    `Each card asks one thing and answers it. The front is a question or a prompt to recall; ` +
    `the back is the answer, as short as it can be while still being complete. Cover the concept ` +
    `itself rather than trivia around it, and prefer the things a student is actually asked in an exam.\n\n` +
    `Write fewer than ${request.requestedCount} if the concept does not warrant that many. ` +
    `Never pad: a card that tests nothing is worse than a missing card, because the student will ` +
    `keep being shown it.${exclusions}`
  );
}
