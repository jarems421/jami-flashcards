import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  buildDailyReviewQueues,
  DAILY_REVIEW_STATE_DOC_ID,
  DAILY_REVIEW_MAX_WEAK_ATTEMPTS,
  normalizeDailyReviewState,
  STUDY_ACTIVITY_SCHEMA_VERSION,
  STUDY_STATE_META_DOC_ID,
  type DailyReviewState,
} from "@/lib/study/daily-review";
import { mapCardData, type Card } from "@/lib/study/cards";
import { getStudyDayKey } from "@/lib/study/day";

const LOAD_MS = 30_000;
const SAVE_MS = 30_000;

function getStudyStateDoc(userId: string, docId: string) {
  return doc(db, "users", userId, "studyState", docId);
}

export async function resetStudyActivityHistory(userId: string) {
  const snapshot = await withTimeout(
    getDocs(collection(db, "users", userId, "studyActivity")),
    LOAD_MS,
    "Load study activity history"
  );

  if (snapshot.empty) {
    return;
  }

  await withTimeout(
    Promise.all(snapshot.docs.map((activityDoc) => deleteDoc(activityDoc.ref))),
    SAVE_MS,
    "Reset study activity history"
  );
}

export async function ensureStudyStateSetup(userId: string) {
  try {
    const metaRef = getStudyStateDoc(userId, STUDY_STATE_META_DOC_ID);
    const metaSnapshot = await withTimeout(
      getDoc(metaRef),
      LOAD_MS,
      "Load study state meta"
    );
    const currentVersion = metaSnapshot.exists()
      ? Number(
          (metaSnapshot.data() as { activitySchemaVersion?: unknown })
            .activitySchemaVersion ?? 0
        )
      : 0;

    if (currentVersion >= STUDY_ACTIVITY_SCHEMA_VERSION) {
      return;
    }

    await resetStudyActivityHistory(userId);
    await withTimeout(
      setDoc(
        metaRef,
        {
          activitySchemaVersion: STUDY_ACTIVITY_SCHEMA_VERSION,
          updatedAt: Date.now(),
        },
        { merge: true }
      ),
      SAVE_MS,
      "Save study state meta"
    );
  } catch (error) {
    console.warn("Study state setup failed; continuing without migration.", error);
  }
}

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

export async function loadDailyReviewState(userId: string) {
  const snapshot = await withTimeout(
    getDoc(getStudyStateDoc(userId, DAILY_REVIEW_STATE_DOC_ID)),
    LOAD_MS,
    "Load daily review state"
  );

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeDailyReviewState(
    snapshot.id,
    snapshot.data() as Record<string, unknown>
  );
}

export async function ensureDailyReviewState(
  userId: string,
  cards: Card[],
  now = Date.now()
): Promise<DailyReviewState> {
  const currentStudyDayKey = getStudyDayKey(now);
  const existingState = await loadDailyReviewState(userId);

  if (existingState?.studyDayKey === currentStudyDayKey) {
    return existingState;
  }

  const { requiredCards, optionalCards } = buildDailyReviewQueues(cards, now);
  const nextState = {
    studyDayKey: currentStudyDayKey,
    generatedAt: now,
    requiredCardIds: requiredCards.map((card) => card.id),
    optionalCardIds: optionalCards.map((card) => card.id),
    completedRequiredCardIds: [] as string[],
    completedOptionalCardIds: [] as string[],
    parkedRequiredCardIds: [] as string[],
    requiredRetryCounts: {} as Record<string, number>,
    updatedAt: now,
  };

  await withTimeout(
    setDoc(getStudyStateDoc(userId, DAILY_REVIEW_STATE_DOC_ID), nextState),
    SAVE_MS,
    "Save daily review state"
  );

  return {
    id: DAILY_REVIEW_STATE_DOC_ID,
    ...nextState,
  };
}

export async function recordDailyReviewWeakAttempt(
  userId: string,
  cardId: string,
  now = Date.now()
) {
  const stateRef = getStudyStateDoc(userId, DAILY_REVIEW_STATE_DOC_ID);

  return withTimeout(
    runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(stateRef);
      const state = snapshot.exists()
        ? normalizeDailyReviewState(
            snapshot.id,
            snapshot.data() as Record<string, unknown>
          )
        : null;
      const currentAttempts = state?.requiredRetryCounts[cardId] ?? 0;
      const attemptCount = currentAttempts + 1;
      const parked = attemptCount >= DAILY_REVIEW_MAX_WEAK_ATTEMPTS;
      const nextRetryCounts = {
        ...(state?.requiredRetryCounts ?? {}),
        [cardId]: attemptCount,
      };
      const nextParkedCardIds =
        parked && state && !state.parkedRequiredCardIds.includes(cardId)
          ? [...state.parkedRequiredCardIds, cardId]
          : state?.parkedRequiredCardIds ?? (parked ? [cardId] : []);

      transaction.set(
        stateRef,
        {
          requiredRetryCounts: nextRetryCounts,
          parkedRequiredCardIds: nextParkedCardIds,
          updatedAt: now,
        },
        { merge: true }
      );

      return { attemptCount, parked };
    }),
    SAVE_MS,
    "Update daily review retry"
  );
}

export async function markDailyReviewCardComplete(
  userId: string,
  cardId: string,
  bucket: "required" | "optional"
) {
  const fieldName =
    bucket === "required"
      ? "completedRequiredCardIds"
      : "completedOptionalCardIds";

  await withTimeout(
    setDoc(
      getStudyStateDoc(userId, DAILY_REVIEW_STATE_DOC_ID),
      {
        [fieldName]: arrayUnion(cardId),
        updatedAt: Date.now(),
      },
      { merge: true }
    ),
    SAVE_MS,
    "Update daily review progress"
  );
}
