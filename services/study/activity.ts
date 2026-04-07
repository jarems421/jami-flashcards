import { collection, doc, getDocs, increment, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  getLocalDayKey,
  normalizeDailyStudyActivity,
  type DailyStudyActivity,
} from "@/lib/study/activity";

const QUERY_MS = 30_000;
const UPDATE_MS = 30_000;

export async function recordStudyReview(
  userId: string,
  reviewedAt = Date.now(),
  options: { isCorrect?: boolean; durationMs?: number } = {}
) {
  const dayKey = getLocalDayKey(reviewedAt);
  const updates: Record<string, unknown> = {
    dayKey,
    reviewCount: increment(1),
    updatedAt: reviewedAt,
  };

  if (options.isCorrect) {
    updates.correctCount = increment(1);
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

