import type { GeneratedCardDraft } from "@/lib/ai/card-generation";
import type { PracticeQuestionDraft } from "@/lib/learning/interventions/practice-request";
import type { InterventionType } from "@/lib/learning/interventions/catalogue";

/**
 * Material Jami has written and nobody has agreed to yet.
 *
 * Both generators stop at the same place on purpose, so there is one thing
 * here rather than one per generator. What differs between a card and a
 * question is how you edit it; what does not differ is that it is unconfirmed,
 * that it belongs to an intervention, that it names a concept, and that
 * cancelling must leave nothing behind. Those belong to the draft, not to
 * whichever editor is on screen.
 *
 * The rule the whole type exists to hold: **a draft is not material and not
 * evidence.** It is a proposal. Nothing about it may be counted, scheduled or
 * scored, and the only thing that turns it into material is a person saying
 * yes.
 */

export type InterventionDraftKind = Extract<
  InterventionType,
  "create_flashcards" | "create_practice"
>;

/** What the student is being shown, by kind. */
export type InterventionDraftPayload =
  | { kind: "create_flashcards"; cards: GeneratedCardDraft[] }
  | { kind: "create_practice"; questions: PracticeQuestionDraft[] };

export type InterventionDraft = {
  /** The recommendation this was generated for. Travels onto everything written. */
  interventionId: string;
  /** The canonical concept, already validated by the generator that made this. */
  conceptId: string;
  conceptLabel: string;
  payload: InterventionDraftPayload;
  /** Items the generator discarded, so the student can be told plainly. */
  dropped: number;
  generatedAt: number;
};

export function draftKind(draft: InterventionDraft): InterventionDraftKind {
  return draft.payload.kind;
}

/** How many pieces of material a draft proposes. */
export function draftSize(draft: InterventionDraft) {
  return draft.payload.kind === "create_flashcards"
    ? draft.payload.cards.length
    : draft.payload.questions.length;
}

/**
 * Whether there is anything left worth confirming.
 *
 * A student who deletes every item has declined the intervention, and
 * confirming nothing must not be possible: it would write no material and
 * still look, to everything downstream, like the advice had been taken.
 */
export function isConfirmable(draft: InterventionDraft) {
  return draftSize(draft) > 0;
}

export type DraftEditRejection = "empty_field" | "unknown_item" | "marks_disagree";

export type DraftEditResult =
  | { ok: true; draft: InterventionDraft }
  | { ok: false; reason: DraftEditRejection };

function nonEmpty(value: string) {
  return value.trim().length > 0;
}

/**
 * Replace one item, having checked the student has not broken it.
 *
 * The same rules the generator was held to, applied to a person: a card needs
 * both sides, and a question's scheme must still account for its tariff. Not
 * because the student is untrusted, but because a question whose scheme no
 * longer adds up cannot be marked, and they would find that out only after
 * sitting it.
 */
export function editDraftItem(
  draft: InterventionDraft,
  index: number,
  next: GeneratedCardDraft | PracticeQuestionDraft
): DraftEditResult {
  if (index < 0 || index >= draftSize(draft)) return { ok: false, reason: "unknown_item" };

  if (draft.payload.kind === "create_flashcards") {
    const card = next as GeneratedCardDraft;
    if (!nonEmpty(card.front) || !nonEmpty(card.back)) {
      return { ok: false, reason: "empty_field" };
    }
    const cards = [...draft.payload.cards];
    cards[index] = { front: card.front.trim(), back: card.back.trim() };
    return { ok: true, draft: { ...draft, payload: { kind: "create_flashcards", cards } } };
  }

  const question = next as PracticeQuestionDraft;
  if (!nonEmpty(question.prompt) || !nonEmpty(question.answer) || question.points.length === 0) {
    return { ok: false, reason: "empty_field" };
  }
  const total = question.points.reduce((sum, point) => sum + point.marks, 0);
  if (total !== question.marks) return { ok: false, reason: "marks_disagree" };

  const questions = [...draft.payload.questions];
  questions[index] = question;
  return { ok: true, draft: { ...draft, payload: { kind: "create_practice", questions } } };
}

/** Drop one item the student does not want. */
export function removeDraftItem(draft: InterventionDraft, index: number): DraftEditResult {
  if (index < 0 || index >= draftSize(draft)) return { ok: false, reason: "unknown_item" };
  if (draft.payload.kind === "create_flashcards") {
    const cards = draft.payload.cards.filter((_, position) => position !== index);
    return { ok: true, draft: { ...draft, payload: { kind: "create_flashcards", cards } } };
  }
  const questions = draft.payload.questions.filter((_, position) => position !== index);
  return { ok: true, draft: { ...draft, payload: { kind: "create_practice", questions } } };
}
