import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { mapCardData, type Card } from "@/lib/study/cards";

const LOAD_MS = 30_000;

/** Firestore caps a batch at 500 writes; 450 leaves room and matches the app's other bulk writes. */
const CARD_WRITE_BATCH_SIZE = 450;

export async function loadUserCards(userId: string): Promise<Card[]> {
  const snapshot = await withTimeout(
    getDocs(query(collection(db, "cards"), where("userId", "==", userId))),
    LOAD_MS,
    "Load study cards"
  );

  return snapshot.docs.map((cardDoc) =>
    mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>)
  );
}

/** Cards in one deck, unsorted; callers order them for their own display. */
export async function getCardsForDeck(
  userId: string,
  deckId: string
): Promise<Card[]> {
  const snapshot = await getDocs(
    query(
      collection(db, "cards"),
      where("deckId", "==", deckId),
      where("userId", "==", userId)
    )
  );

  return snapshot.docs.map((cardDoc) =>
    mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>)
  );
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
}

export async function updateCardTopics(cardId: string, topicIds: string[]) {
  await updateDoc(doc(db, "cards", cardId), { topicIds, tags: [] });
}

export async function deleteCard(cardId: string) {
  await deleteDoc(doc(db, "cards", cardId));
}

export async function setCardTopicsInBulk(
  updates: ReadonlyArray<{ id: string; topicIds: string[] }>
) {
  for (let start = 0; start < updates.length; start += CARD_WRITE_BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const card of updates.slice(start, start + CARD_WRITE_BATCH_SIZE)) {
      batch.update(doc(db, "cards", card.id), {
        topicIds: card.topicIds,
        tags: [],
      });
    }
    await batch.commit();
  }
}

export async function moveCardsToDeck(
  cardIds: readonly string[],
  deckId: string
) {
  for (let start = 0; start < cardIds.length; start += CARD_WRITE_BATCH_SIZE) {
    const batch = writeBatch(db);
    cardIds.slice(start, start + CARD_WRITE_BATCH_SIZE).forEach((cardId) => {
      batch.update(doc(db, "cards", cardId), { deckId });
    });
    await batch.commit();
  }
}

export async function deleteCards(cardIds: readonly string[]) {
  for (let start = 0; start < cardIds.length; start += CARD_WRITE_BATCH_SIZE) {
    const batch = writeBatch(db);
    cardIds.slice(start, start + CARD_WRITE_BATCH_SIZE).forEach((cardId) => {
      batch.delete(doc(db, "cards", cardId));
    });
    await batch.commit();
  }
}
