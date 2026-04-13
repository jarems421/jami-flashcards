import { db } from "../firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  DEFAULT_DECK_COLOR_PRESET,
  DEFAULT_DECK_ICON_PRESET,
  type DeckColorPresetId,
  type DeckIconPresetId,
} from "@/lib/study/deck-style";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

export type Deck = {
  id: string;
  name: string;
  userId: string;
  createdAt: number;
  colorPreset: DeckColorPresetId;
  iconPreset: DeckIconPresetId;
};

type DeckDoc = {
  name?: string;
  userId?: string;
  uid?: string;
  createdAt?: number;
  colorPreset?: string;
  iconPreset?: string;
};

const LOAD_MS = 30_000;
const CREATE_MS = 30_000;
const UPDATE_MS = 30_000;
const DELETE_MS = 30_000;
const BATCH_DELETE_LIMIT = 400;

type DeckSnapshot = QueryDocumentSnapshot | DocumentSnapshot;

function snapshotToDeck(docSnap: DeckSnapshot): Deck | null {
  if (!docSnap.exists()) {
    return null;
  }

  const data = docSnap.data() as DeckDoc;
  const owner = (data.userId ?? data.uid ?? "").trim();
  if (!owner) return null;

  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Untitled";
  const createdAt = typeof data.createdAt === "number" ? data.createdAt : 0;
  const colorPreset =
    typeof data.colorPreset === "string"
      ? (data.colorPreset as DeckColorPresetId)
      : DEFAULT_DECK_COLOR_PRESET;
  const iconPreset =
    typeof data.iconPreset === "string"
      ? (data.iconPreset as DeckIconPresetId)
      : DEFAULT_DECK_ICON_PRESET;

  return {
    id: docSnap.id,
    name,
    userId: owner,
    createdAt,
    colorPreset,
    iconPreset,
  };
}

async function deleteSnapshotsInBatches(
  snapshots: QueryDocumentSnapshot[],
  label: string
) {
  if (snapshots.length === 0) {
    return;
  }

  for (let index = 0; index < snapshots.length; index += BATCH_DELETE_LIMIT) {
    const batch = writeBatch(db);
    const chunk = snapshots.slice(index, index + BATCH_DELETE_LIMIT);
    for (const snapshot of chunk) {
      batch.delete(snapshot.ref);
    }

    await withTimeout(batch.commit(), DELETE_MS, label);
  }
}

async function getOwnedDeck(userId: string, deckId: string): Promise<Deck | null> {
  const normalizedUserId = userId.trim();
  const normalizedDeckId = deckId.trim();

  if (!normalizedUserId) {
    throw new Error("Missing userId");
  }
  if (!normalizedDeckId) {
    throw new Error("Missing deckId");
  }

  const snapshot = await withTimeout(
    getDoc(doc(db, "decks", normalizedDeckId)),
    LOAD_MS,
    "Load deck"
  );
  const deck = snapshotToDeck(snapshot);

  if (!deck || deck.userId !== normalizedUserId) {
    return null;
  }

  return deck;
}

async function requireOwnedDeck(userId: string, deckId: string): Promise<Deck> {
  const deck = await getOwnedDeck(userId, deckId);
  if (!deck) {
    throw new Error("Deck not found.");
  }

  return deck;
}

async function deleteUserDeckHistory(userId: string, deckId: string): Promise<void> {
  const attemptsSnapshot = await withTimeout(
    getDocs(collection(db, "users", userId, "decks", deckId, "attempts")),
    LOAD_MS,
    "Load deck attempts for deletion"
  );

  await deleteSnapshotsInBatches(attemptsSnapshot.docs, "Delete deck attempts");

  await withTimeout(
    deleteDoc(doc(db, "users", userId, "decks", deckId)),
    DELETE_MS,
    "Delete user deck record"
  );
}

export const createDeck = async (userId: string, name: string): Promise<Deck> => {
  const normalizedUserId = userId.trim();
  const deckName = name.trim();

  if (!normalizedUserId) {
    throw new Error("Missing userId");
  }
  if (!deckName) {
    throw new Error("Deck name is required");
  }

  const createdAt = Date.now();
  const docRef = await withTimeout(
    addDoc(collection(db, "decks"), {
      name: deckName,
      userId: normalizedUserId,
      createdAt,
      colorPreset: DEFAULT_DECK_COLOR_PRESET,
      iconPreset: DEFAULT_DECK_ICON_PRESET,
    }),
    CREATE_MS,
    "Create deck"
  );

  return {
    id: docRef.id,
    name: deckName,
    userId: normalizedUserId,
    createdAt,
    colorPreset: DEFAULT_DECK_COLOR_PRESET,
    iconPreset: DEFAULT_DECK_ICON_PRESET,
  };
};

export const getDecks = async (userId: string): Promise<Deck[]> => {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId");
  }

  const col = collection(db, "decks");
  const qByUserId = query(col, where("userId", "==", normalizedUserId));
  const qByLegacyUid = query(col, where("uid", "==", normalizedUserId));

  const [byUserId, byLegacyUid] = await Promise.all([
    withTimeout(getDocs(qByUserId), LOAD_MS, "Load decks (userId)"),
    withTimeout(getDocs(qByLegacyUid), LOAD_MS, "Load decks (uid)"),
  ]);

  const merged = new Map<string, Deck>();

  for (const d of byUserId.docs) {
    const deck = snapshotToDeck(d);
    if (deck && deck.userId === normalizedUserId) merged.set(d.id, deck);
  }
  for (const d of byLegacyUid.docs) {
    const deck = snapshotToDeck(d);
    if (deck && deck.userId === normalizedUserId) merged.set(d.id, deck);
  }

  return Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt);
};

export const getDeckById = async (
  userId: string,
  deckId: string
): Promise<Deck | null> => getOwnedDeck(userId, deckId);

export const renameDeck = async (
  userId: string,
  deckId: string,
  name: string
): Promise<string> => {
  const normalizedDeckId = deckId.trim();
  const deckName = name.trim();

  if (!deckName) {
    throw new Error("Deck name is required");
  }

  await requireOwnedDeck(userId, normalizedDeckId);

  await withTimeout(
    updateDoc(doc(db, "decks", normalizedDeckId), {
      name: deckName,
    }),
    UPDATE_MS,
    "Rename deck"
  );

  return deckName;
};

export const updateDeckStyle = async (
  userId: string,
  deckId: string,
  style: {
    colorPreset: DeckColorPresetId;
    iconPreset: DeckIconPresetId;
  }
): Promise<void> => {
  const normalizedDeckId = deckId.trim();
  await requireOwnedDeck(userId, normalizedDeckId);

  await withTimeout(
    updateDoc(doc(db, "decks", normalizedDeckId), {
      colorPreset: style.colorPreset,
      iconPreset: style.iconPreset,
    }),
    UPDATE_MS,
    "Update deck style"
  );
};

export const deleteDeck = async (
  userId: string,
  deckId: string
): Promise<void> => {
  const normalizedUserId = userId.trim();
  const normalizedDeckId = deckId.trim();

  if (!normalizedUserId) {
    throw new Error("Missing userId");
  }
  if (!normalizedDeckId) {
    throw new Error("Missing deckId");
  }

  await requireOwnedDeck(normalizedUserId, normalizedDeckId);

  const cardsSnapshot = await withTimeout(
    getDocs(
      query(
        collection(db, "cards"),
        where("deckId", "==", normalizedDeckId),
        where("userId", "==", normalizedUserId)
      )
    ),
    DELETE_MS,
    "Load deck cards for deletion"
  );

  await deleteSnapshotsInBatches(cardsSnapshot.docs, "Delete deck cards");

  await deleteUserDeckHistory(normalizedUserId, normalizedDeckId);

  await withTimeout(
    deleteDoc(doc(db, "decks", normalizedDeckId)),
    DELETE_MS,
    "Delete deck"
  );
};

