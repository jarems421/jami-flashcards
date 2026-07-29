import { collection, getDocs, query, where } from "firebase/firestore";
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
