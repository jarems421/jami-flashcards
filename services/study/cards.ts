import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  getDocs,
  increment,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateAllDashboardData, invalidateDashboardData } from "@/services/dashboard/cache";
import {
  readThroughCache,
  type CachedReadOptions,
} from "@/services/cache/read-through";
import { isFirebasePermissionDenied } from "@/services/firebase/errors";
import {
  mapCardData,
  normalizeCardContentInput,
  type Card,
  type CardReviewUpdateCommand,
  type ImportedCardDraft,
} from "@/lib/study/cards";
import { reportTutorialAction } from "@/lib/onboarding/tutorial";

const LOAD_MS = 30_000;

/** Firestore caps a batch at 500 writes; 450 leaves room and matches the app's other bulk writes. */
const CARD_WRITE_BATCH_SIZE = 450;

type CreateCardInput = {
  userId: string;
  deckId: string;
  front: string;
  back: string;
  topicIds?: readonly string[];
  createdAt?: number;
};

type CreateCardsInBatchesInput = {
  userId: string;
  deckId: string;
  drafts: readonly ImportedCardDraft[];
  topicIds?: readonly string[];
  createdAtBase?: number;
};

type CardWrite = Pick<
  Card,
  "deckId" | "userId" | "front" | "back" | "tags" | "topicIds" | "createdAt"
>;

export class CardBatchCreateError extends Error {
  readonly createdCards: Card[];
  readonly cause: unknown;

  constructor(message: string, createdCards: readonly Card[], cause: unknown) {
    super(message);
    this.name = "CardBatchCreateError";
    this.createdCards = [...createdCards];
    this.cause = cause;
  }
}

function buildNewCard(
  input: Omit<CreateCardInput, "createdAt">,
  id: string,
  createdAt: number
): Card {
  return {
    id,
    deckId: input.deckId,
    userId: input.userId,
    front: normalizeCardContentInput(input.front),
    back: normalizeCardContentInput(input.back),
    tags: [],
    topicIds: [...(input.topicIds ?? [])],
    createdAt,
  };
}

function getCardWrite(card: Card): CardWrite {
  return {
    deckId: card.deckId,
    userId: card.userId,
    front: card.front,
    back: card.back,
    tags: card.tags,
    topicIds: card.topicIds,
    createdAt: card.createdAt,
  };
}

/**
 * Every card the student owns.
 *
 * Six pages ask for this. `docs/data-access-audit.md` records why the complete
 * set is required rather than paged -- FSRS state, due queues and duplicate
 * warnings are all functions of the whole -- so the fix for asking six times is
 * to ask once and share it.
 *
 * Anything that grades, edits or schedules a card must pass `{ force: true }`:
 * a card's next state is computed from its current one, and a stale copy would
 * write back the wrong answer.
 */
export async function loadUserCards(
  userId: string,
  options: CachedReadOptions = {}
): Promise<Card[]> {
  return readThroughCache(
    { collection: "cards", userId },
    () => loadUserCardsFromServer(userId),
    options
  );
}

async function loadUserCardsFromServer(userId: string): Promise<Card[]> {
  const cards = collection(db, "cards");
  const [current, legacy] = await Promise.all([
    withTimeout(
      getDocs(query(cards, where("userId", "==", userId))),
      LOAD_MS,
      "Load study cards"
    ),
    withTimeout(
      getDocs(query(cards, where("uid", "==", userId))),
      LOAD_MS,
      "Load legacy study cards"
    ).catch((error: unknown) => {
      if (isFirebasePermissionDenied(error)) {
        console.warn(
          "Legacy card lookup was denied; continuing with current userId cards."
        );
        return null;
      }
      throw error;
    }),
  ]);
  const merged = new Map<string, Card>();
  [current, legacy].forEach((snapshot) => {
    snapshot?.docs.forEach((cardDoc) => {
      const card = mapCardData(
        cardDoc.id,
        cardDoc.data() as Record<string, unknown>
      );
      if (card.userId === userId) merged.set(card.id, card);
    });
  });
  return Array.from(merged.values());
}

/** Cards in one deck, unsorted; callers order them for their own display. */
export async function getCardsForDeck(
  userId: string,
  deckId: string
): Promise<Card[]> {
  const cards = collection(db, "cards");
  const [current, legacy] = await Promise.all([
    getDocs(
      query(cards, where("deckId", "==", deckId), where("userId", "==", userId))
    ),
    getDocs(
      query(cards, where("deckId", "==", deckId), where("uid", "==", userId))
    ).catch((error: unknown) => {
      if (isFirebasePermissionDenied(error)) return null;
      throw error;
    }),
  ]);
  const merged = new Map<string, Card>();
  [current, legacy].forEach((snapshot) => {
    snapshot?.docs.forEach((cardDoc) => {
      const card = mapCardData(
        cardDoc.id,
        cardDoc.data() as Record<string, unknown>
      );
      if (card.userId === userId) merged.set(card.id, card);
    });
  });
  return Array.from(merged.values());
}

/**
 * Card writes clear `tags`: topics replaced the old free-text tags, and a card
 * that is edited should not keep a stale copy of them.
 */
export async function updateCardContent(
  cardId: string,
  input: { front: string; back: string; topicIds: string[] }
) {
  await updateDoc(doc(db, "cards", cardId), {
    front: input.front,
    back: input.back,
    topicIds: input.topicIds,
    tags: [],
  });
  invalidateAllDashboardData();
}

export async function updateCardTopics(cardId: string, topicIds: string[]) {
  await updateDoc(doc(db, "cards", cardId), { topicIds, tags: [] });
  invalidateAllDashboardData();
}

export async function deleteCard(cardId: string) {
  await deleteDoc(doc(db, "cards", cardId));
  invalidateAllDashboardData();
}

export async function setCardTopicsInBulk(
  updates: ReadonlyArray<{ id: string; topicIds: string[] }>
) {
  let committed = false;
  try {
    for (let start = 0; start < updates.length; start += CARD_WRITE_BATCH_SIZE) {
      const batch = writeBatch(db);
      for (const card of updates.slice(start, start + CARD_WRITE_BATCH_SIZE)) {
        batch.update(doc(db, "cards", card.id), {
          topicIds: card.topicIds,
          tags: [],
        });
      }
      await batch.commit();
      committed = true;
    }
  } finally {
    if (committed) invalidateAllDashboardData();
  }
}

export async function moveCardsToDeck(
  cardIds: readonly string[],
  deckId: string
) {
  let committed = false;
  try {
    for (let start = 0; start < cardIds.length; start += CARD_WRITE_BATCH_SIZE) {
      const batch = writeBatch(db);
      cardIds.slice(start, start + CARD_WRITE_BATCH_SIZE).forEach((cardId) => {
        batch.update(doc(db, "cards", cardId), { deckId });
      });
      await batch.commit();
      committed = true;
    }
  } finally {
    if (committed) invalidateAllDashboardData();
  }
}

export async function deleteCards(cardIds: readonly string[]) {
  let committed = false;
  try {
    for (let start = 0; start < cardIds.length; start += CARD_WRITE_BATCH_SIZE) {
      const batch = writeBatch(db);
      cardIds.slice(start, start + CARD_WRITE_BATCH_SIZE).forEach((cardId) => {
        batch.delete(doc(db, "cards", cardId));
      });
      await batch.commit();
      committed = true;
    }
  } finally {
    if (committed) invalidateAllDashboardData();
  }
}

export async function updateCardAfterReview(
  cardId: string,
  command: CardReviewUpdateCommand
) {
  const updates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(command.values ?? {})) {
    if (value !== undefined) {
      updates[key] = value;
    }
  }

  for (const [key, amount] of Object.entries(command.increments ?? {})) {
    if (typeof amount === "number" && amount !== 0) {
      updates[key] = increment(amount);
    }
  }

  if (command.clearMemoryRiskOverrideDayKey) {
    updates.memoryRiskOverrideDayKey = deleteField();
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  await updateDoc(doc(db, "cards", cardId), updates);
  invalidateAllDashboardData();
}

export async function recordSimpleStudyResult(
  cardId: string,
  result: "correct" | "wrong",
  reviewedAt: number
) {
  await updateCardAfterReview(cardId, {
    values: {
      simpleStudyLastResult: result,
      simpleStudyLastReviewedAt: reviewedAt,
    },
    increments:
      result === "correct"
        ? { simpleStudyCorrectCount: 1 }
        : { simpleStudyWrongCount: 1 },
  });
}

export async function createCard(input: CreateCardInput): Promise<Card> {
  const createdAt = input.createdAt ?? Date.now();
  const cardsCollection = collection(db, "cards");
  const write = buildNewCard(input, "", createdAt);
  const cardRef = await addDoc(cardsCollection, getCardWrite(write));
  invalidateDashboardData(input.userId);
  reportTutorialAction("create-card", { deckId: input.deckId });

  return {
    ...write,
    id: cardRef.id,
  };
}

export async function createCardsInBatches(
  input: CreateCardsInBatchesInput,
  onProgress?: (completed: number, total: number) => void
): Promise<Card[]> {
  const createdCards: Card[] = [];
  const createdAtBase = input.createdAtBase ?? Date.now();
  const cardsCollection = collection(db, "cards");

  try {
    for (
      let start = 0;
      start < input.drafts.length;
      start += CARD_WRITE_BATCH_SIZE
    ) {
      const batch = writeBatch(db);
      const chunk = input.drafts.slice(start, start + CARD_WRITE_BATCH_SIZE);
      const chunkCards: Card[] = [];

      chunk.forEach((draft, index) => {
        const cardIndex = start + index;
        const cardRef = doc(cardsCollection);
        const card = buildNewCard(
          {
            userId: input.userId,
            deckId: input.deckId,
            front: draft.front,
            back: draft.back,
            topicIds: input.topicIds,
          },
          cardRef.id,
          createdAtBase - cardIndex
        );

        batch.set(cardRef, getCardWrite(card));
        chunkCards.push(card);
      });

      await batch.commit();
      createdCards.push(...chunkCards);
      onProgress?.(createdCards.length, input.drafts.length);
    }

    if (createdCards.length > 0) {
      invalidateDashboardData(input.userId);
      reportTutorialAction("create-card", { deckId: input.deckId });
    }
    return createdCards;
  } catch (error) {
    if (createdCards.length > 0) invalidateDashboardData(input.userId);
    throw new CardBatchCreateError(
      error instanceof Error ? error.message : "Failed to create cards.",
      createdCards,
      error
    );
  }
}
