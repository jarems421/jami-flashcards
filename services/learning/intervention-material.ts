import { getCustomStudyHref } from "@/lib/app/routes";
import type { GeneratedCardDraft } from "@/lib/ai/card-generation";
import type { InterventionDraft } from "@/lib/learning/interventions/draft";
import type { Deck } from "@/lib/study/decks";
import { createCardsInBatches } from "@/services/study/cards";
import { createDeck } from "@/services/study/decks";
import { storeInterventionPractice } from "@/services/learning/intervention-generation";
import { invalidateDashboardData } from "@/services/dashboard/cache";

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

/**
 * Keeping practice questions, through the server.
 *
 * Not a client write, and the rules are explicit about why: a browser may
 * create only an *uploaded* paper carrying no questions and no marks, because
 * no assessment definition or answer-bearing guide may originate there. The
 * answers also have to be stored where no client can read them, which a
 * browser cannot do on its own behalf.
 */
async function confirmPractice(input: {
  uid: string;
  draft: InterventionDraft;
  questions: Extract<InterventionDraft["payload"], { kind: "create_practice" }>["questions"];
  folderId: string;
}): Promise<ConfirmedMaterial> {
  const { notebookId } = await storeInterventionPractice({
    conceptId: input.draft.conceptId,
    folderId: input.folderId,
    interventionId: input.draft.interventionId,
    questions: input.questions,
  });
  invalidateDashboardData(input.uid);
  return {
    kind: "create_practice",
    created: input.questions.length,
    href: `/dashboard/notebooks/${encodeURIComponent(notebookId)}`,
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
