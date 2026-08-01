import {
  collection,
  doc,
  documentId,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { invalidateDashboardData } from "@/services/dashboard/cache";
import {
  normalizeDailyStudyActivity,
  type DailyStudyActivity,
} from "@/lib/study/activity";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";

const QUERY_MS = 30_000;
const UPDATE_MS = 30_000;

export async function recordStudyReview(
  userId: string,
  reviewedAt = Date.now(),
  options: {
    isCorrect?: boolean;
    durationMs?: number;
    sessionKind?: "daily" | "custom";
  } = {}
) {
  const dayKey = getStudyDayKey(reviewedAt);
  const updates: Record<string, unknown> = {
    dayKey,
    reviewCount: increment(1),
    updatedAt: reviewedAt,
  };

  if (options.isCorrect) {
    updates.correctCount = increment(1);
  }

  if (options.sessionKind === "daily") {
    updates.dailyReviewCount = increment(1);
    if (options.isCorrect) {
      updates.dailyCorrectCount = increment(1);
    }
  }

  if (options.sessionKind === "custom") {
    updates.customReviewCount = increment(1);
    if (options.isCorrect) {
      updates.customCorrectCount = increment(1);
    }
  }

  if (typeof options.durationMs === "number" && options.durationMs > 0) {
    updates.totalDurationMs = increment(options.durationMs);
  }

  await withTimeout(
    setDoc(
      doc(db, "users", userId, "studyActivity", dayKey),
      updates,
      { merge: true }
    ),
    UPDATE_MS,
    "Record study activity"
  );
  invalidateDashboardData(userId);
}

export async function loadStudyActivity(userId: string): Promise<DailyStudyActivity[]> {
  const snapshot = await withTimeout(
    getDocs(collection(db, "users", userId, "studyActivity")),
    QUERY_MS,
    "Load study activity"
  );

  return snapshot.docs
    .map((activityDoc) =>
      normalizeDailyStudyActivity(
        activityDoc.id,
        activityDoc.data() as Record<string, unknown>
      )
    )
    .sort((left, right) => left.dayKey.localeCompare(right.dayKey));
}

const DASHBOARD_ACTIVITY_PAGE_SIZE = 32;

/**
 * Today needs the trailing week plus the complete current streak. Pages are
 * read newest-first until the first missing study day proves the streak has
 * ended. A long unbroken streak therefore remains exact without turning every
 * dashboard visit into an all-history scan. Progress deliberately keeps its
 * separate all-time loader.
 */
export async function loadDashboardStudyActivity(
  userId: string,
  now = Date.now()
): Promise<DailyStudyActivity[]> {
  const activityCollection = collection(db, "users", userId, "studyActivity");
  const todayKey = getStudyDayKey(now);
  let expectedDayKey = todayKey;
  let todayMayBeMissing = true;
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
  let streakComplete = false;
  const activity: DailyStudyActivity[] = [];

  while (!streakComplete) {
    const pageQuery: Query<DocumentData> = cursor
      ? query(
          activityCollection,
          orderBy(documentId(), "desc"),
          startAfter(cursor),
          limit(DASHBOARD_ACTIVITY_PAGE_SIZE)
        )
      : query(
          activityCollection,
          orderBy(documentId(), "desc"),
          limit(DASHBOARD_ACTIVITY_PAGE_SIZE)
        );
    const snapshot: QuerySnapshot<DocumentData> = await withTimeout(
      getDocs(pageQuery),
      QUERY_MS,
      "Load recent study activity"
    );
    const page = snapshot.docs.map((activityDoc) =>
      normalizeDailyStudyActivity(
        activityDoc.id,
        activityDoc.data() as Record<string, unknown>
      )
    );
    activity.push(...page);

    for (const entry of page) {
      if (entry.dayKey > expectedDayKey) continue;

      if (entry.dayKey < expectedDayKey && todayMayBeMissing) {
        expectedDayKey = getPreviousStudyDayKey(expectedDayKey);
        todayMayBeMissing = false;
      }

      if (entry.dayKey < expectedDayKey) {
        streakComplete = true;
        break;
      }

      if (entry.dayKey === expectedDayKey) {
        if (entry.reviewCount <= 0) {
          if (!todayMayBeMissing) {
            streakComplete = true;
            break;
          }
        }
        expectedDayKey = getPreviousStudyDayKey(expectedDayKey);
        todayMayBeMissing = false;
      }
    }

    if (snapshot.docs.length < DASHBOARD_ACTIVITY_PAGE_SIZE) {
      streakComplete = true;
    } else {
      cursor = snapshot.docs.at(-1) ?? null;
    }
  }

  return activity.sort((left, right) => left.dayKey.localeCompare(right.dayKey));
}

function getPreviousStudyDayKey(dayKey: string) {
  return shiftStudyDayKey(dayKey, -1);
}
