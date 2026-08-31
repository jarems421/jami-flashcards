import { db } from "../firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { isFirebasePermissionDenied } from "@/services/firebase/errors";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import {
  readThroughCache,
  type CachedReadOptions,
} from "@/services/cache/read-through";
import {
  invalidateLegacyActiveRecords,
  loadCachedLegacyActiveRecords,
} from "@/services/study/active-compatibility";
import { normalizeFolderIds } from "@/lib/workspace/folder-links";
import {
  DEFAULT_DECK_COLOR_PRESET,
  DEFAULT_DECK_ICON_PRESET,
  DECK_STYLE_VERSION,
  normalizeDeckColorPreset,
  normalizeDeckIconPreset,
  type DeckColorPresetId,
  type DeckIconPresetId,
} from "@/lib/study/deck-style";
import type { Deck } from "@/lib/study/decks";
import { reportTutorialAction } from "@/lib/onboarding/tutorial";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

type DeckDoc = {
  name?: string;
  userId?: string;
  uid?: string;
  createdAt?: number;
  colorPreset?: string;
  iconPreset?: string;
  styleVersion?: string;
  folderIds?: unknown;
};

const LOAD_MS = 30_000;
const CREATE_MS = 30_000;
const UPDATE_MS = 30_000;
const DELETE_MS = 30_000;
const BATCH_DELETE_LIMIT = 400;
const DECKS_COLLECTION = "decks";

type DeckSnapshot = QueryDocumentSnapshot | DocumentSnapshot;

function deckDataToDeck(id: string, data: DeckDoc): Deck | null {
  const owner = (data.userId ?? data.uid ?? "").trim();
  if (!owner) return null;

  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Untitled";
  const createdAt = typeof data.createdAt === "number" ? data.createdAt : 0;
  const styleVersion = typeof data.styleVersion === "string" ? data.styleVersion : undefined;
  const usesSharedObjectStyle = styleVersion === DECK_STYLE_VERSION;
  const colorPreset = usesSharedObjectStyle
    ? normalizeDeckColorPreset(data.colorPreset)
    : DEFAULT_DECK_COLOR_PRESET;
  const iconPreset = usesSharedObjectStyle
    ? normalizeDeckIconPreset(data.iconPreset)
    : DEFAULT_DECK_ICON_PRESET;
  const folderIds = Array.isArray(data.folderIds)
    ? data.folderIds
        .filter((folderId): folderId is string => typeof folderId === "string" && Boolean(folderId.trim()))
        .map((folderId) => folderId.trim().slice(0, 160))
        .slice(0, 12)
    : [];

  return {
    id,
    name,
    userId: owner,
    createdAt,
    colorPreset,
    iconPreset,
    styleVersion,
    folderIds,
  };
}

function snapshotToDeck(docSnap: DeckSnapshot): Deck | null {
  if (!docSnap.exists()) {
    return null;
  }
  return deckDataToDeck(docSnap.id, docSnap.data() as DeckDoc);
}

function compareFolderDecks(left: Deck, right: Deck) {
  const createdAtDifference = right.createdAt - left.createdAt;
  if (createdAtDifference !== 0) return createdAtDifference;
  return right.id.localeCompare(left.id);
}

function isDeckAfterFolderCursor(
  deck: Deck,
  cursor: DeckFolderPageCursor
) {
  return (
    deck.createdAt < cursor.createdAt ||
    (deck.createdAt === cursor.createdAt && deck.id < cursor.id)
  );
}

function invalidateDeckCaches(userId: string) {
  invalidateDashboardData(userId);
  invalidateLegacyActiveRecords(userId, DECKS_COLLECTION);
}

async function deleteSnapshotsInBatches(
  snapshots: QueryDocumentSnapshot[],
  label: string,
  onCommitted?: () => void
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
    onCommitted?.();
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

async function deleteUserDeckHistory(
  userId: string,
  deckId: string,
  onCommitted?: () => void
): Promise<void> {
  const attemptsSnapshot = await withTimeout(
    getDocs(collection(db, "users", userId, "decks", deckId, "attempts")),
    LOAD_MS,
    "Load deck attempts for deletion"
  );

  await deleteSnapshotsInBatches(
    attemptsSnapshot.docs,
    "Delete deck attempts",
    onCommitted
  );

  await withTimeout(
    deleteDoc(doc(db, "users", userId, "decks", deckId)),
    DELETE_MS,
    "Delete user deck record"
  );
}

export const createDeck = async (
  userId: string,
  name: string,
  options: { folderIds?: string[] } = {}
): Promise<Deck> => {
  const normalizedUserId = userId.trim();
  const deckName = name.trim();

  if (!normalizedUserId) {
    throw new Error("Missing userId");
  }
  if (!deckName) {
    throw new Error("Deck name is required");
  }

  const createdAt = Date.now();
  const folderIds = normalizeFolderIds(options.folderIds ?? []);
  const docRef = await withTimeout(
    addDoc(collection(db, "decks"), {
      name: deckName,
      userId: normalizedUserId,
      createdAt,
      colorPreset: DEFAULT_DECK_COLOR_PRESET,
      iconPreset: DEFAULT_DECK_ICON_PRESET,
      styleVersion: DECK_STYLE_VERSION,
      folderIds,
    }),
    CREATE_MS,
    "Create deck"
  );
  invalidateDeckCaches(normalizedUserId);
  reportTutorialAction("create-deck", { deckId: docRef.id });

  return {
    id: docRef.id,
    name: deckName,
    userId: normalizedUserId,
    createdAt,
    colorPreset: DEFAULT_DECK_COLOR_PRESET,
    iconPreset: DEFAULT_DECK_ICON_PRESET,
    styleVersion: DECK_STYLE_VERSION,
    folderIds,
  };
};

/**
 * Every deck the student owns.
 *
 * Six pages ask for this, so the result is shared rather than fetched once per
 * page. Pass `{ force: true }` from anything that writes the result back.
 */
export const getDecks = async (
  userId: string,
  options: CachedReadOptions = {}
): Promise<Deck[]> => {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("Missing userId");
  }

  return readThroughCache(
    { collection: "decks", userId: normalizedUserId },
    () => loadDecks(normalizedUserId),
    options
  );
};

const loadDecks = async (normalizedUserId: string): Promise<Deck[]> => {
  const col = collection(db, "decks");
  const qByUserId = query(col, where("userId", "==", normalizedUserId));
  const qByLegacyUid = query(col, where("uid", "==", normalizedUserId));

  const byUserId = await withTimeout(getDocs(qByUserId), LOAD_MS, "Load decks (userId)");
  const byLegacyUid = await withTimeout(getDocs(qByLegacyUid), LOAD_MS, "Load decks (uid)").catch(
    (error: unknown) => {
      if (isFirebasePermissionDenied(error)) {
        console.warn("Legacy deck lookup was denied; continuing with current userId decks.");
        return null;
      }
      throw error;
    }
  );

  const merged = new Map<string, Deck>();

  for (const d of byUserId.docs) {
    const deck = snapshotToDeck(d);
    if (deck && deck.userId === normalizedUserId) merged.set(d.id, deck);
  }
  if (byLegacyUid) {
    for (const d of byLegacyUid.docs) {
      const deck = snapshotToDeck(d);
      if (deck && deck.userId === normalizedUserId) merged.set(d.id, deck);
    }
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
  invalidateDeckCaches(userId);

  return deckName;
};

export type DeckFolderPageCursor = { createdAt: number; id: string };

export const getDecksForFolderPage = async (
  userId: string,
  folderId: string,
  options: { cursor?: DeckFolderPageCursor | null; pageSize?: number } = {}
) => {
  const normalizedUserId = userId.trim();
  const normalizedFolderId = folderId.trim();
  if (!normalizedUserId) throw new Error("Missing userId");
  if (!normalizedFolderId) throw new Error("Missing folderId");
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 30));

  const decksCollection = collection(db, "decks");
  const buildFolderPageQuery = (ownerField: "userId" | "uid") =>
    query(
      decksCollection,
      where(ownerField, "==", normalizedUserId),
      where("folderIds", "array-contains", normalizedFolderId),
      orderBy("createdAt", "desc"),
      orderBy(documentId(), "desc"),
      ...(options.cursor
        ? [startAfter(options.cursor.createdAt, options.cursor.id)]
        : []),
      limit(pageSize + 1)
    );
  const [current, legacy] = await Promise.all([
    withTimeout(
      getDocs(buildFolderPageQuery("userId")),
      LOAD_MS,
      "Load folder deck page"
    ),
    withTimeout(
      getDocs(buildFolderPageQuery("uid")),
      LOAD_MS,
      "Load legacy folder deck page"
    ).catch((error: unknown) => {
      if (isFirebasePermissionDenied(error)) {
        console.warn(
          "Legacy folder deck lookup was denied; continuing with current userId decks."
        );
        return null;
      }
      throw error;
    }),
  ]);
  const legacyWithoutCreatedAt = await loadCachedLegacyActiveRecords(
    normalizedUserId,
    `${DECKS_COLLECTION}:folder:${normalizedFolderId}`,
    async () => {
      const buildCompatibilityQuery = (ownerField: "userId" | "uid") =>
        query(
          decksCollection,
          where(ownerField, "==", normalizedUserId),
          where("folderIds", "array-contains", normalizedFolderId)
        );
      const [currentCompatibility, legacyCompatibility] = await Promise.all([
        withTimeout(
          getDocs(buildCompatibilityQuery("userId")),
          LOAD_MS,
          "Load folder deck compatibility records"
        ),
        withTimeout(
          getDocs(buildCompatibilityQuery("uid")),
          LOAD_MS,
          "Load legacy folder deck compatibility records"
        ).catch((error: unknown) => {
          if (isFirebasePermissionDenied(error)) return null;
          throw error;
        }),
      ]);

      return [currentCompatibility, legacyCompatibility]
        .filter(
          (value): value is typeof currentCompatibility => value !== null
        )
        .flatMap((snapshot) => snapshot.docs)
        .filter((deckDoc) => typeof deckDoc.data().createdAt !== "number")
        .map((deckDoc) => ({
          id: deckDoc.id,
          data: deckDoc.data() as Record<string, unknown>,
        }));
    }
  );
  const merged = new Map<string, Deck>();
  for (const snapshot of [current, legacy].filter(
    (value): value is typeof current => value !== null
  )) {
    snapshot.docs.forEach((deckDoc) => {
      const deck = snapshotToDeck(deckDoc);
      if (deck?.userId === normalizedUserId) merged.set(deck.id, deck);
    });
  }
  legacyWithoutCreatedAt.forEach((record) => {
    const deck = deckDataToDeck(record.id, record.data as DeckDoc);
    if (
      deck?.userId === normalizedUserId &&
      (!options.cursor || isDeckAfterFolderCursor(deck, options.cursor))
    ) {
      merged.set(deck.id, deck);
    }
  });
  const mergedItems = Array.from(merged.values()).sort(compareFolderDecks);
  const items = mergedItems.slice(0, pageSize);
  const finalItem = items.at(-1);
  const hasMore =
    current.docs.length > pageSize ||
    (legacy?.docs.length ?? 0) > pageSize ||
    mergedItems.length > pageSize;

  return {
    items,
    nextCursor:
      hasMore && finalItem
        ? { createdAt: finalItem.createdAt, id: finalItem.id }
        : null,
  };
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
      styleVersion: DECK_STYLE_VERSION,
    }),
    UPDATE_MS,
    "Update deck style"
  );
  invalidateDeckCaches(userId);
};

export const updateDeckFolders = async (
  userId: string,
  deckId: string,
  folderIds: string[]
): Promise<void> => {
  const normalizedDeckId = deckId.trim();
  await requireOwnedDeck(userId, normalizedDeckId);

  const normalizedFolderIds = Array.from(
    new Set(
      folderIds
        .map((folderId) => folderId.trim().slice(0, 160))
        .filter(Boolean)
    )
  ).slice(0, 12);

  await withTimeout(
    updateDoc(doc(db, "decks", normalizedDeckId), {
      folderIds: normalizedFolderIds,
    }),
    UPDATE_MS,
    "Update deck folders"
  );
  invalidateDeckCaches(userId);
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

  const [currentCardsSnapshot, legacyCardsSnapshot] = await Promise.all([
    withTimeout(
      getDocs(
        query(
          collection(db, "cards"),
          where("deckId", "==", normalizedDeckId),
          where("userId", "==", normalizedUserId)
        )
      ),
      DELETE_MS,
      "Load deck cards for deletion"
    ),
    withTimeout(
      getDocs(
        query(
          collection(db, "cards"),
          where("deckId", "==", normalizedDeckId),
          where("uid", "==", normalizedUserId)
        )
      ),
      DELETE_MS,
      "Load legacy deck cards for deletion"
    ),
  ]);
  const cardDocuments = Array.from(
    new Map(
      [...currentCardsSnapshot.docs, ...legacyCardsSnapshot.docs].map(
        (cardDoc) => [cardDoc.id, cardDoc]
      )
    ).values()
  );
  const invalidateDeckData = () => invalidateDeckCaches(normalizedUserId);

  await deleteSnapshotsInBatches(
    cardDocuments,
    "Delete deck cards",
    invalidateDeckData
  );

  await deleteUserDeckHistory(
    normalizedUserId,
    normalizedDeckId,
    invalidateDeckData
  );

  await withTimeout(
    deleteDoc(doc(db, "decks", normalizedDeckId)),
    DELETE_MS,
    "Delete deck"
  );
  invalidateDeckData();
};
