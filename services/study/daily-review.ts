import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { commitStudyEffect } from "@/services/study/commit-effect";
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import {
  migrationKnownSettled,
  rememberMigrationSettled,
} from "@/lib/app/settled-migrations";
import {
  DAILY_REVIEW_STATE_DOC_ID,
  DAILY_REVIEW_MAX_WEAK_ATTEMPTS,
  normalizeDailyReviewState,
  planDailyReviewState,
  STUDY_ACTIVITY_SCHEMA_VERSION,
  STUDY_STATE_META_DOC_ID,
  type DailyReviewState,
} from "@/lib/study/daily-review";
import type { Card } from "@/lib/study/cards";
import type { PersistedStudySession } from "@/lib/study/session";

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
  invalidateDashboardData(userId);
}

export async function ensureStudyStateSetup(userId: string) {
  // Checked on every Today load, before any of its reads could start.
  if (migrationKnownSettled(userId, "studyActivity", STUDY_ACTIVITY_SCHEMA_VERSION)) return;
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
      rememberMigrationSettled(userId, "studyActivity", STUDY_ACTIVITY_SCHEMA_VERSION);
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
    rememberMigrationSettled(userId, "studyActivity", STUDY_ACTIVITY_SCHEMA_VERSION);
  } catch (error) {
    console.warn("Study state setup failed; continuing without migration.", error);
  }
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
  now = Date.now(),
  options: {
    activeSession?: PersistedStudySession | null;
    /**
     * The stored state, already read. Learn reads it beside the cards rather
     * than after them, since it does not depend on them.
     */
    existingState?: DailyReviewState | null;
  } = {}
): Promise<DailyReviewState> {
  const existingState =
    options.existingState !== undefined ? options.existingState : await loadDailyReviewState(userId);
  const { state, save } = planDailyReviewState(existingState, cards, now, options.activeSession ?? null);

  if (save) {
    /*
     * Saved behind the page rather than before it: waiting for the server's
     * acknowledgement held Learn and Today back a full round trip on most
     * visits. Nothing is lost by not waiting. This device sends its writes in
     * the order they were made, so a card finished straight afterwards still
     * lands on top of this state; a retry, which is a transaction and so goes
     * to the server by its own way, waits for it (see `settledDailyReviewSave`);
     * and a save that never lands is worked out again on the next visit.
     */
    const saved = withTimeout(
      setDoc(getStudyStateDoc(userId, DAILY_REVIEW_STATE_DOC_ID), save),
      SAVE_MS,
      "Save daily review state"
    ).catch((error) => {
      console.warn("Saving today's Daily Review failed; it is worked out again next visit.", error);
    });
    savingDailyReview.set(userId, saved);
    void saved.then(() => {
      if (savingDailyReview.get(userId) === saved) savingDailyReview.delete(userId);
    });
  }

  return state;
}

/** Per student, the Daily Review save still on its way from this device. Never rejects. */
const savingDailyReview = new Map<string, Promise<void>>();

/**
 * Once this device's last Daily Review save has landed or failed.
 *
 * A transaction reads from the server and commits by its own way, not behind
 * the writes this device has queued. One run before a save landed would read
 * the old state and then be overwritten by it, so a retry counted in that
 * moment would be lost.
 */
function settledDailyReviewSave(userId: string) {
  return savingDailyReview.get(userId) ?? Promise.resolve();
}

export async function recordDailyReviewWeakAttempt(
  userId: string,
  cardId: string,
  now = Date.now(),
  commitId?: string
) {
  const stateRef = getStudyStateDoc(userId, DAILY_REVIEW_STATE_DOC_ID);
  await settledDailyReviewSave(userId);

  return withTimeout(
    (commitId
      ? (apply: (transaction: import("firebase/firestore").Transaction) => Promise<{ attemptCount: number; parked: boolean }>) => commitStudyEffect({ userId, commitId }, "daily-retry", apply)
      : (apply: (transaction: import("firebase/firestore").Transaction) => Promise<{ attemptCount: number; parked: boolean }>) => runTransaction(db, apply))(async (transaction) => {
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
