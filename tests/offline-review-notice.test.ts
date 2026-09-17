// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  OFFLINE_SYNC_GRACE_MS,
  getStuckOfflineReviews,
  queueOfflineStudyReview,
} from "@/lib/study/offline-study";

function queue(reviewedAt: number, cardId: string) {
  queueOfflineStudyReview({
    userId: "user-1",
    cardId,
    rating: "good",
    reviewedAt,
    studyDayKey: "2026-09-17",
    isCorrect: true,
    sessionKind: "custom",
    cardUpdates: {},
  });
}

describe("which queued answers are worth telling a student about", () => {
  beforeEach(() => window.localStorage.clear());

  it("says nothing about an answer that was just given", () => {
    const now = Date.now();
    queue(now, "card-1");
    expect(getStuckOfflineReviews("user-1", now)).toHaveLength(0);
  });

  it("counts an answer that has sat past the grace period", () => {
    const now = Date.now();
    queue(now - OFFLINE_SYNC_GRACE_MS - 1, "card-1");
    queue(now, "card-2");
    const stuck = getStuckOfflineReviews("user-1", now);
    expect(stuck.map((review) => review.cardId)).toEqual(["card-1"]);
  });
});
