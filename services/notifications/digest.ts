import "server-only";

import {
  normalizeNotificationPreferences,
  type NotificationMode,
} from "@/lib/app/notifications";
import { buildDailyReviewQueues } from "@/lib/study/daily-review";
import { getStudyDayWindow } from "@/lib/study/day";
import { mapCardData } from "@/lib/study/cards";
import { toPushRecord } from "@/lib/app/push-subscriptions";
import { getAdminDb } from "@/services/firebase/admin";
import {
  isExpiredPushSubscriptionError,
  sendPushNotification,
} from "@/services/notifications/web-push";
import { createLogger, type Logger } from "@/lib/observability/logger";

export const DIGEST_CLAIM_TTL_MS = 10 * 60 * 1000;
export const DIGEST_PAGE_SIZE = 100;
export const DIGEST_USER_CONCURRENCY = 5;
export const DIGEST_DURATION_WARNING_MS = 240_000;

export type NotificationDigestSummary = {
  considered: number;
  claimed: number;
  sent: number;
  removed: number;
  skipped: number;
  failed: number;
  partial: boolean;
};

type DigestDependencies = {
  adminDb?: ReturnType<typeof getAdminDb>;
  clock?: () => number;
  createClaimId?: () => string;
  logger?: Pick<Logger, "error" | "warn">;
  sendPush?: (
    subscription: Parameters<typeof sendPushNotification>[0],
    payload: Parameters<typeof sendPushNotification>[1]
  ) => Promise<unknown>;
};

type UserDigestResult = Omit<NotificationDigestSummary, "partial">;

function emptyUserResult(): UserDigestResult {
  return {
    considered: 1,
    claimed: 0,
    sent: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
  };
}

function getDigestClaim(data: Record<string, unknown>) {
  return {
    studyDayKey:
      typeof data.digestClaimStudyDayKey === "string"
        ? data.digestClaimStudyDayKey
        : typeof data.digestClaimDayKey === "string"
          ? data.digestClaimDayKey
          : null,
    claimId: typeof data.digestClaimId === "string" ? data.digestClaimId : null,
    claimedAt:
      typeof data.digestClaimedAt === "number" &&
      Number.isFinite(data.digestClaimedAt)
        ? data.digestClaimedAt
        : null,
  };
}

function buildDigestPayload(
  requiredDailyCount: number,
  urgentGoalCount: number,
  mode: NotificationMode
) {
  const parts: string[] = [];

  if (requiredDailyCount > 0) {
    parts.push(
      `${requiredDailyCount} recommended Daily Review card${requiredDailyCount === 1 ? "" : "s"}`
    );
  }

  if (urgentGoalCount > 0) {
    parts.push(
      `${urgentGoalCount} urgent goal${urgentGoalCount === 1 ? "" : "s"}`
    );
  }

  if (parts.length > 0) {
    return {
      title: "Daily Review is ready",
      body: parts.join(" | "),
      url:
        requiredDailyCount > 0
          ? "/dashboard/study?mode=daily"
          : "/dashboard/goals",
      tag: "daily-digest",
      icon: "/icons/notification-icon-192.png",
      badge: "/icons/notification-icon-192.png",
    };
  }

  if (mode !== "always") return null;

  return {
    title: "Study window is open",
    body: "Daily Review is clear. Use Focused Review or tidy up your cards.",
    url: "/dashboard/study?mode=custom",
    tag: "daily-digest",
    icon: "/icons/notification-icon-192.png",
    badge: "/icons/notification-icon-192.png",
  };
}

async function claimDigestWindow(
  adminDb: ReturnType<typeof getAdminDb>,
  preferencesRef: FirebaseFirestore.DocumentReference,
  studyDayKey: string,
  claimId: string,
  now: number
) {
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(preferencesRef);
    const data = (snapshot.data() as Record<string, unknown> | undefined) ?? {};
    const preferences = normalizeNotificationPreferences(data);
    const digestClaim = getDigestClaim(data);

    if (!preferences.enabled) {
      return "disabled" as const;
    }

    if (preferences.lastDigestStudyDayKey === studyDayKey) {
      return "already-sent" as const;
    }

    if (
      digestClaim.studyDayKey === studyDayKey &&
      digestClaim.claimId &&
      digestClaim.claimedAt !== null &&
      now - digestClaim.claimedAt < DIGEST_CLAIM_TTL_MS
    ) {
      return "already-claimed" as const;
    }

    transaction.set(
      preferencesRef,
      {
        digestClaimStudyDayKey: studyDayKey,
        digestClaimDayKey: null,
        digestClaimId: claimId,
        digestClaimedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    return "claimed" as const;
  });
}

async function finalizeDigestWindow(
  adminDb: ReturnType<typeof getAdminDb>,
  preferencesRef: FirebaseFirestore.DocumentReference,
  studyDayKey: string,
  claimId: string,
  now: number,
  markSent: boolean
) {
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(preferencesRef);
    const data = (snapshot.data() as Record<string, unknown> | undefined) ?? {};
    const digestClaim = getDigestClaim(data);

    if (
      digestClaim.studyDayKey !== studyDayKey ||
      digestClaim.claimId !== claimId
    ) {
      return false;
    }

    transaction.set(
      preferencesRef,
      {
        digestClaimStudyDayKey: null,
        digestClaimDayKey: null,
        digestClaimId: null,
        digestClaimedAt: null,
        lastDigestStudyDayKey: markSent
          ? studyDayKey
          : data.lastDigestStudyDayKey ?? data.lastDigestDayKey ?? null,
        lastDigestSentAt: markSent
          ? now
          : typeof data.lastDigestSentAt === "number"
            ? data.lastDigestSentAt
            : null,
        updatedAt: now,
      },
      { merge: true }
    );

    return true;
  });
}

async function countRequiredDailyReviewCards(
  adminDb: ReturnType<typeof getAdminDb>,
  userId: string,
  now: number
) {
  const cardsSnapshot = await adminDb
    .collection("cards")
    .where("userId", "==", userId)
    .get();
  const cards = cardsSnapshot.docs.map((cardDoc) =>
    mapCardData(
      cardDoc.id,
      cardDoc.data() as Record<string, unknown>
    )
  );
  return buildDailyReviewQueues(cards, now).requiredCards.length;
}

async function countUrgentGoals(
  adminDb: ReturnType<typeof getAdminDb>,
  userId: string,
  now: number
) {
  const { end } = getStudyDayWindow(now);
  const goalsCollection = adminDb
    .collection("users")
    .doc(userId)
    .collection("goals");
  const [activeGoalsSnapshot, compatibilitySnapshot] = await Promise.all([
    goalsCollection
      .where("status", "==", "active")
      .where("deadline", ">", 0)
      .where("deadline", "<=", end)
      .count()
      .get(),
    // Early goals omitted `status`, which Firestore equality filters exclude.
    // This deadline-scoped compatibility read is deliberately capped because
    // the digest only needs a useful reminder count, not an unbounded history.
    goalsCollection
      .where("deadline", ">", 0)
      .where("deadline", "<=", end)
      .limit(100)
      .get(),
  ]);
  const legacyActiveCount = compatibilitySnapshot.docs.filter((goalDoc) => {
    const status = goalDoc.data().status;
    return (
      status !== "active" &&
      status !== "completed" &&
      status !== "failed" &&
      status !== "cancelled"
    );
  }).length;

  return activeGoalsSnapshot.data().count + legacyActiveCount;
}

function getPreferenceUserId(
  preferencesDoc: FirebaseFirestore.QueryDocumentSnapshot
) {
  const segments = preferencesDoc.ref.path.split("/");
  if (
    segments.length !== 4 ||
    segments[0] !== "users" ||
    !segments[1] ||
    segments[2] !== "notificationPreferences" ||
    segments[3] !== "config"
  ) {
    return null;
  }
  return segments[1];
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      () => runWorker()
    )
  );
  return results;
}

function addUserResult(
  summary: Omit<NotificationDigestSummary, "partial">,
  result: UserDigestResult
) {
  summary.considered += result.considered;
  summary.claimed += result.claimed;
  summary.sent += result.sent;
  summary.removed += result.removed;
  summary.skipped += result.skipped;
  summary.failed += result.failed;
}

async function processPreference(
  preferencesDoc: FirebaseFirestore.QueryDocumentSnapshot,
  input: { now: number; studyDayKey: string },
  dependencies: Required<
    Pick<
      DigestDependencies,
      "adminDb" | "clock" | "createClaimId" | "logger" | "sendPush"
    >
  >
) {
  const result = emptyUserResult();
  const userId = getPreferenceUserId(preferencesDoc);
  if (!userId) {
    result.skipped = 1;
    dependencies.logger.warn("preferences.unexpected_path", {
      path: preferencesDoc.ref.path,
    });
    return result;
  }

  let claimId: string | null = null;
  let claimOpen = false;
  let markedSent = false;

  try {
    const preferences = normalizeNotificationPreferences(
      preferencesDoc.data() as Record<string, unknown>
    );
    const [requiredDailyCount, urgentGoalCount, subscriptionsSnapshot] =
      await Promise.all([
        countRequiredDailyReviewCards(
          dependencies.adminDb,
          userId,
          input.now
        ),
        countUrgentGoals(dependencies.adminDb, userId, input.now),
        dependencies.adminDb
          .collection("users")
          .doc(userId)
          .collection("pushSubscriptions")
          .get(),
      ]);
    const payload = buildDigestPayload(
      requiredDailyCount,
      urgentGoalCount,
      preferences.mode
    );

    if (!payload || subscriptionsSnapshot.empty) {
      result.skipped = 1;
      return result;
    }

    claimId = dependencies.createClaimId();
    const claimResult = await claimDigestWindow(
      dependencies.adminDb,
      preferencesDoc.ref,
      input.studyDayKey,
      claimId,
      input.now
    );
    if (claimResult !== "claimed") {
      result.skipped = 1;
      return result;
    }

    claimOpen = true;
    result.claimed = 1;

    for (const subscriptionDoc of subscriptionsSnapshot.docs) {
      const subscription = toPushRecord(
        subscriptionDoc.data() as Record<string, unknown>
      );
      if (!subscription) {
        await subscriptionDoc.ref.delete();
        result.removed += 1;
        continue;
      }

      try {
        await dependencies.sendPush(subscription, payload);
        result.sent += 1;

        if (!markedSent) {
          const finalized = await finalizeDigestWindow(
            dependencies.adminDb,
            preferencesDoc.ref,
            input.studyDayKey,
            claimId,
            dependencies.clock(),
            true
          );
          if (!finalized) {
            throw new Error("The notification digest claim changed before it could be finalized.");
          }
          markedSent = true;
          claimOpen = false;
        }
      } catch (error) {
        if (isExpiredPushSubscriptionError(error)) {
          await subscriptionDoc.ref.delete();
          result.removed += 1;
          continue;
        }

        result.failed = 1;
        dependencies.logger.error("push.send_failed", { userId, error });
      }
    }

    if (result.sent === 0 && result.failed === 0) result.skipped = 1;
  } catch (error) {
    result.failed = 1;
    dependencies.logger.error("user.processing_failed", { userId, error });
  } finally {
    if (claimOpen && claimId && !markedSent) {
      try {
        await finalizeDigestWindow(
          dependencies.adminDb,
          preferencesDoc.ref,
          input.studyDayKey,
          claimId,
          dependencies.clock(),
          false
        );
      } catch (error) {
        result.failed = 1;
        dependencies.logger.error("claim.release_failed", { userId, error });
      }
    }
  }

  return result;
}

export async function runNotificationDigest(
  input: {
    now: number;
    studyDayKey: string;
    durationWarningMs?: number;
  },
  dependencies: DigestDependencies = {}
): Promise<NotificationDigestSummary> {
  const adminDb = dependencies.adminDb ?? getAdminDb();
  const clock = dependencies.clock ?? Date.now;
  const logger =
    dependencies.logger ?? createLogger({ service: "notifications.digest" });
  const resolvedDependencies = {
    adminDb,
    clock,
    createClaimId: dependencies.createClaimId ?? (() => crypto.randomUUID()),
    logger,
    sendPush: dependencies.sendPush ?? sendPushNotification,
  };
  const durationWarningMs =
    input.durationWarningMs ?? DIGEST_DURATION_WARNING_MS;
  const startedAt = clock();
  let durationWarningEmitted = false;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const summary: Omit<NotificationDigestSummary, "partial"> = {
    considered: 0,
    claimed: 0,
    sent: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
  };

  const maybeWarnAboutDuration = () => {
    const elapsedMs = clock() - startedAt;
    if (durationWarningEmitted || elapsedMs < durationWarningMs) return;
    durationWarningEmitted = true;
    logger.warn("run.approaching_duration_budget", {
      elapsedMs,
      durationWarningMs,
      considered: summary.considered,
      sent: summary.sent,
      failed: summary.failed,
    });
  };

  for (;;) {
    let query = adminDb
      .collectionGroup("notificationPreferences")
      .where("enabled", "==", true)
      .limit(DIGEST_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);

    const page = await query.get();
    if (page.empty) break;

    const results = await mapWithConcurrency(
      page.docs,
      DIGEST_USER_CONCURRENCY,
      async (preferencesDoc) => {
        const result = await processPreference(
          preferencesDoc,
          input,
          resolvedDependencies
        );
        maybeWarnAboutDuration();
        return result;
      }
    );
    results.forEach((result) => addUserResult(summary, result));

    if (page.docs.length < DIGEST_PAGE_SIZE) break;
    cursor = page.docs.at(-1);
  }

  return {
    ...summary,
    partial: summary.failed > 0,
  };
}
