import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { mapCardData, type Card } from "@/lib/study/cards";

const LOAD_MS = 30_000;

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
