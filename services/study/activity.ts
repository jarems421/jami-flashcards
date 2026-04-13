import { collection, doc, getDocs, increment, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  normalizeDailyStudyActivity,
  type DailyStudyActivity,
} from "@/lib/study/activity";
import { getStudyDayKey } from "@/lib/study/day";

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
