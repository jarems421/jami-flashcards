import {
  addDoc,
  collection,
  deleteField,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateAllDashboardData, invalidateDashboardData } from "@/services/dashboard/cache";
import {
  getCachedReadRevision,
  peekCachedRead,
  readThroughCache,
  seedCachedRead,
  type CachedReadOptions,
} from "@/services/cache/read-through";
import { keepDeviceCardSet, readDeviceCardSet } from "@/services/study/card-device-copy";
import { isRecord, readOwnDataRoute, signedInStudent } from "@/services/study/own-data-route";
import {
  mapCardData,
  normalizeCardContentInput,
  type Card,
  type CardReviewUpdateCommand,
  type ImportedCardDraft,
} from "@/lib/study/cards";
import type { CardImage } from "@/lib/study/card-images";
import type { CardOcclusion } from "@/lib/study/image-occlusion";
import type { CardStudySettings } from "@/lib/study/study-modes";
import { reportTutorialAction } from "@/lib/onboarding/tutorial";

const LOAD_MS = 30_000;
/** Cards per read request: small enough that one request is never the slow part of a large account. */
const CARD_READ_PAGE_SIZE = 1_000;

/** Firestore caps a batch at 500 writes; 450 leaves room and matches the app's other bulk writes. */
const CARD_WRITE_BATCH_SIZE = 450;

type CreateCardInput = {
  userId: string;
  deckId: string;
  front: string;
  back: string;
  frontImage?: CardImage;
  backImage?: CardImage;
  occlusion?: CardOcclusion;
  topicIds?: readonly string[];
  createdAt?: number;
  /** The recommendation that asked for this card, when Jami wrote it. */
  createdByInterventionId?: string;
  /** The author's own settings, from `applyStudySettingsDraft`. */
  studySettings?: CardStudySettings;
};

type CreateCardsInBatchesInput = {
  userId: string;
  deckId: string;
  drafts: readonly ImportedCardDraft[];
  topicIds?: readonly string[];
  createdAtBase?: number;
  /** The recommendation that asked for these cards, when Jami wrote them. */
  createdByInterventionId?: string;
};

type CardWrite = Pick<
  Card,
  "deckId" | "userId" | "front" | "back" | "tags" | "topicIds" | "createdAt"
> &
  Partial<Pick<Card, "frontImage" | "backImage" | "occlusion" | "createdByInterventionId" | "studySettings">>;

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

export function buildNewCard(
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
    // Left off entirely when absent: Firestore refuses an explicit undefined.
    ...(input.frontImage ? { frontImage: input.frontImage } : {}),
    ...(input.backImage ? { backImage: input.backImage } : {}),
    ...(input.occlusion ? { occlusion: input.occlusion } : {}),
    /*
     * Provenance, attached at creation.
     *
     * The field was on the input type and on the stored shape, and the write
     * dropped it silently -- so a card Jami wrote in answer to a recommendation
     * was indistinguishable from one the student typed, and the question the
     * intervention loop exists to answer ("did the work we asked for happen?")
     * had no way to be asked of a card.
     */
    ...(input.createdByInterventionId
      ? { createdByInterventionId: input.createdByInterventionId }
      : {}),
    ...(input.studySettings ? { studySettings: input.studySettings } : {}),
    tags: [],
    topicIds: [...(input.topicIds ?? [])],
    createdAt,
  };
}

export function getCardWrite(card: Card): CardWrite {
  return {
    deckId: card.deckId,
    userId: card.userId,
    front: card.front,
    back: card.back,
    ...(card.frontImage ? { frontImage: card.frontImage } : {}),
    ...(card.backImage ? { backImage: card.backImage } : {}),
    ...(card.occlusion ? { occlusion: card.occlusion } : {}),
    ...(card.createdByInterventionId
      ? { createdByInterventionId: card.createdByInterventionId }
      : {}),
    ...(card.studySettings ? { studySettings: card.studySettings } : {}),
    tags: card.tags,
    topicIds: card.topicIds,
    createdAt: card.createdAt,
  };
}

/**
 * Every card the student owns.
 *
 * Six pages ask for this. `docs/data-access-audit.md` records why the complete
 * set is required rather than a page of it -- FSRS state, due queues and
 * duplicate warnings are all functions of the whole -- so the fix for asking six
 * times is to ask once and share it.
 *
 * Anything that grades, edits or schedules a card must pass `{ force: true }`:
 * a card's next state is computed from its current one, and a stale copy would
 * write back the wrong answer.
 *
 * A page that only shows cards is drawn from this device's copy when it has one
 * (see `card-device-copy`), and redrawn when the server's set arrives, so a
 * student with thousands of cards is not kept waiting on all of them.
 */
export async function loadUserCards(
  userId: string,
  options: CachedReadOptions = {}
): Promise<Card[]> {
  const key = { collection: "cards", userId };
  const load = () => loadAndKeepUserCards(userId);
  if (!options.force && !peekCachedRead(key)) {
    const kept = await readDeviceCardSet(userId);
    if (kept) seedCachedRead(key, kept, load);
  }
  return readThroughCache(key, load, options);
}

/** The server's set, kept on the device unless a write landed while it was read. */
async function loadAndKeepUserCards(userId: string) {
  const revisionAtStart = getCachedReadRevision(userId);
  const cards = await loadUserCardsFromServer(userId);
  if (getCachedReadRevision(userId) === revisionAtStart) void keepDeviceCardSet(userId, cards);
  return cards;
}

/**
 * The student's whole set, fresh from the server.
 *
 * Read through Jami's own route (`/api/study/cards`), which reads beside the
 * database and sends the cards as one compressed response per few thousand.
 * The browser's own Firestore read of the same cards stays as the fallback,
 * for when the route cannot be reached.
 */
async function loadUserCardsFromServer(userId: string): Promise<Card[]> {
  const student = signedInStudent(userId);
  if (!student) return loadUserCardsFromFirestore(userId);
  try {
    return await loadUserCardsThroughRoute(student);
  } catch (error) {
    console.warn("Reading cards through the server failed; reading them directly.", error);
    return loadUserCardsFromFirestore(userId);
  }
}

/**
 * Every page of the route's answer, checked card by card.
 *
 * Five thousand cards through the browser's Firestore connection took fifteen
 * to thirty seconds on a phone over 4G. The route sends the same cards in a
 * fraction of the bytes.
 */
async function loadUserCardsThroughRoute(student: NonNullable<ReturnType<typeof signedInStudent>>) {
  const cards: Card[] = [];
  let after: string | null = null;
  do {
    const path: string = after ? `/api/study/cards?after=${encodeURIComponent(after)}` : "/api/study/cards";
    const page = await readOwnDataRoute(student, path, "Load study cards");
    if (!Array.isArray(page.cards)) throw new Error("Load study cards: the route answered without cards.");
    for (const card of page.cards) {
      if (isRecord(card) && typeof card.id === "string") cards.push(mapCardData(card.id, card));
    }
    after = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null;
  } while (after);
  return cards;
}

/**
 * The whole set, fetched a page at a time by the browser itself.
 *
 * One request for every card held a student with thousands of them to a single
 * time limit, which their cards outgrew: past thirty seconds every page that
 * needed the cards failed to load, though nothing was wrong. In pages, each
 * request is a fixed size with its own limit, so a large account takes longer
 * rather than failing. The result is the same complete set as before.
 */
async function loadUserCardsFromFirestore(userId: string): Promise<Card[]> {
  const cards: Card[] = [];
  let after: QueryDocumentSnapshot | null = null;
  for (;;) {
    const page: QuerySnapshot = await withTimeout(
      getDocs(
        query(
          collection(db, "cards"),
          where("userId", "==", userId),
          orderBy(documentId()),
          ...(after ? [startAfter(after)] : []),
          limit(CARD_READ_PAGE_SIZE)
        )
      ),
      LOAD_MS,
      "Load study cards"
    );
    for (const cardDoc of page.docs) {
      cards.push(mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>));
    }
    if (page.docs.length < CARD_READ_PAGE_SIZE) return cards;
    after = page.docs[page.docs.length - 1];
  }
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
  input: {
    front: string;
    back: string;
    topicIds: string[];
    /** Only sides that changed: an image to set, or null to remove it. */
    frontImage?: CardImage | null;
    backImage?: CardImage | null;
    /** Only when they changed: the author's own settings, or null to clear them. */
    studySettings?: CardStudySettings | null;
  }
) {
  await updateDoc(doc(db, "cards", cardId), {
    front: input.front,
    back: input.back,
    topicIds: input.topicIds,
    tags: [],
    ...(input.frontImage !== undefined
      ? { frontImage: input.frontImage ?? deleteField() }
      : {}),
    ...(input.backImage !== undefined
      ? { backImage: input.backImage ?? deleteField() }
      : {}),
    ...(input.studySettings !== undefined
      ? { studySettings: input.studySettings ?? deleteField() }
      : {}),
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
  command: CardReviewUpdateCommand,
  identity?: import("@/services/study/commit-effect").StudyCommitIdentity,
  effect = "card"
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

  if (identity) {
    const { commitStudyEffect } = await import("@/services/study/commit-effect");
    await commitStudyEffect(identity, effect, async (transaction) => {
      transaction.update(doc(db, "cards", cardId), updates);
      return null;
    });
  } else await updateDoc(doc(db, "cards", cardId), updates);
  invalidateAllDashboardData();
}

export async function recordSimpleStudyResult(
  cardId: string,
  result: "correct" | "wrong",
  reviewedAt: number,
  identity?: import("@/services/study/commit-effect").StudyCommitIdentity
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
  }, identity);
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
            ...(input.createdByInterventionId
              ? { createdByInterventionId: input.createdByInterventionId }
              : {}),
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
