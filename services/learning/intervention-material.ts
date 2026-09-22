import { getCustomStudyHref } from "@/lib/app/routes";
import type { GeneratedCardDraft } from "@/lib/ai/card-generation";
import type { InterventionDraft } from "@/lib/learning/interventions/draft";
import { practiceToStore } from "@/lib/learning/interventions/practice-store";
import type { Deck } from "@/lib/study/decks";
import { createCardsInBatches } from "@/services/study/cards";
import { createDeck } from "@/services/study/decks";
import { createNotebook } from "@/services/study/notebooks";
import { createInterventionPracticePaper } from "@/services/study/practice-papers";

/**
 * Writing the material a student has just agreed to.
 *
 * The step that turns a draft into the student's own material, and the only
 * one that writes anything. Everything before it -- the recommendation, the
 * generation, the review screen -- is reversible by walking away.
 *
 * Nothing here records evidence, and that is the point. Cards written are not
 * cards answered and questions written are not questions sat, so agreeing to
 * material moves no mastery, no confidence and no intervention to completed.
 * What it returns is somewhere to go and do the work, which is what actually
 * closes the loop.
 */

export type ConfirmedMaterial = {
  /** Where the student goes next to actually do it. */
  href: string;
  /** What was written, for the moment that tells them. */
  created: number;
  kind: InterventionDraft["payload"]["kind"];
};

/**
 * The deck generated cards belong in.
 *
 * An existing deck in the folder wins, so a student ends up with one deck per
 * subject rather than a new one per recommendation. Only a folder with no deck
 * at all gets one made, named after the folder rather than after Jami: it is
 * the student's deck from the moment it exists, and they will be looking at it
 * long after they have forgotten which suggestion created it.
 */
async function resolveDeck(input: {
  uid: string;
  folderId: string;
  folderName: string;
  decks: readonly Deck[];
}) {
  const existing = input.decks.find((deck) => deck.folderIds.includes(input.folderId));
  if (existing) return existing.id;
  const created = await createDeck(input.uid, input.folderName || "Flashcards", {
    folderIds: [input.folderId],
  });
  return created.id;
}

async function confirmCards(input: {
  uid: string;
  draft: InterventionDraft;
  cards: readonly GeneratedCardDraft[];
  folderId: string;
  folderName: string;
  decks: readonly Deck[];
}): Promise<ConfirmedMaterial> {
  const deckId = await resolveDeck(input);
  await createCardsInBatches({
    userId: input.uid,
    deckId,
    drafts: input.cards.map((card) => ({ front: card.front, back: card.back })),
    // The canonical concept, attached at creation rather than inferred later:
    // this is what makes answers to these cards land on the right concept.
    topicIds: [input.draft.conceptId],
    createdByInterventionId: input.draft.interventionId,
  });
  return {
    kind: "create_flashcards",
    created: input.cards.length,
    /*
     * Straight into a session on the concept, carrying the recommendation that
     * asked for the cards -- so finishing it records the work against the
     * advice that prompted it rather than looking like an unrelated review.
     */
    href: getCustomStudyHref({
      mode: "custom",
      deckIds: [deckId],
      topicIds: [input.draft.conceptId],
      fromActionId: input.draft.interventionId,
    }),
  };
}

async function confirmPractice(input: {
  uid: string;
  draft: InterventionDraft;
  questions: Extract<InterventionDraft["payload"], { kind: "create_practice" }>["questions"];
  folderId: string;
}): Promise<ConfirmedMaterial> {
  const stored = practiceToStore(input.questions, {
    conceptId: input.draft.conceptId,
    interventionId: input.draft.interventionId,
  });
  const notebook = await createNotebook(input.uid, {
    folderId: input.folderId,
    title: input.draft.conceptLabel,
    type: "practice_paper",
    topicIds: [input.draft.conceptId],
  });
  await createInterventionPracticePaper({
    userId: input.uid,
    notebook,
    conceptLabel: input.draft.conceptLabel,
    questions: stored.questions,
    markScheme: stored.markScheme,
    interventionId: input.draft.interventionId,
  });
  return {
    kind: "create_practice",
    created: stored.questions.length,
    href: `/dashboard/notebooks/${encodeURIComponent(notebook.id)}`,
  };
}

/**
 * Store a confirmed draft, and say where to go and do it.
 *
 * Throws rather than half-succeeding quietly: the review screen is still open
 * at this point, so a failure leaves the student looking at the material they
 * asked for with the chance to try again, which is better than a page that
 * moves on as though something had been saved.
 */
export async function confirmInterventionDraft(input: {
  uid: string;
  draft: InterventionDraft;
  folderId: string;
  folderName: string;
  decks: readonly Deck[];
}): Promise<ConfirmedMaterial> {
  const { draft } = input;
  if (draft.payload.kind === "create_flashcards") {
    return confirmCards({ ...input, cards: draft.payload.cards });
  }
  return confirmPractice({ ...input, questions: draft.payload.questions });
}
