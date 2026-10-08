import "server-only";

import {
  normalizeNotificationPreferences,
  type NotificationMode,
} from "@/lib/app/notifications";
import { getDueNudge, type NudgeKind } from "@/lib/app/notification-schedule";
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

/**
 * Where each kind of nudge keeps its claim and its record of being sent, so the
 * digest and the evening reminder are each sent at most once a day without
 * either one blocking the other.
 */
const NUDGE_FIELDS = {
  digest: {
    claimDayKey: "digestClaimStudyDayKey",
    legacyClaimDayKey: "digestClaimDayKey",
    claimId: "digestClaimId",
    claimedAt: "digestClaimedAt",
    lastDayKey: "lastDigestStudyDayKey",
    legacyLastDayKey: "lastDigestDayKey",
    lastSentAt: "lastDigestSentAt",
  },
  evening: {
    claimDayKey: "eveningClaimDayKey",
    legacyClaimDayKey: null,
    claimId: "eveningClaimId",
    claimedAt: "eveningClaimedAt",
    lastDayKey: "lastEveningReminderDayKey",
    legacyLastDayKey: null,
    lastSentAt: "lastEveningReminderSentAt",
  },
} as const satisfies Record<NudgeKind, Record<string, string | null>>;

function readString(data: Record<string, unknown>, field: string | null) {
  const value = field ? data[field] : undefined;
  return typeof value === "string" ? value : null;
}

function getNudgeClaim(data: Record<string, unknown>, kind: NudgeKind) {
  const fields = NUDGE_FIELDS[kind];
  const claimedAt = data[fields.claimedAt];
  return {
    dayKey: readString(data, fields.claimDayKey) ?? readString(data, fields.legacyClaimDayKey),
    claimId: readString(data, fields.claimId),
    claimedAt: typeof claimedAt === "number" && Number.isFinite(claimedAt) ? claimedAt : null,
  };
}

function lastNudgeDayKey(data: Record<string, unknown>, kind: NudgeKind) {
  const fields = NUDGE_FIELDS[kind];
  return readString(data, fields.lastDayKey) ?? readString(data, fields.legacyLastDayKey);
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

/** The evening nudge, only while there is still something waiting. */
function buildEveningReminderPayload(requiredDailyCount: number) {
  if (requiredDailyCount <= 0) return null;
  return {
    title: "Daily Review is still waiting",
    body: `${requiredDailyCount} card${requiredDailyCount === 1 ? "" : "s"} left today. A few minutes now keeps it from piling up.`,
    url: "/dashboard/study?mode=daily",
    tag: "evening-reminder",
    icon: "/icons/notification-icon-192.png",
    badge: "/icons/notification-icon-192.png",
  };
}

async function claimNudge(
  adminDb: ReturnType<typeof getAdminDb>,
  preferencesRef: FirebaseFirestore.DocumentReference,
  kind: NudgeKind,
  dayKey: string,
  claimId: string,
  now: number
) {
  const fields = NUDGE_FIELDS[kind];
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(preferencesRef);
    const data = (snapshot.data() as Record<string, unknown> | undefined) ?? {};
    const claim = getNudgeClaim(data, kind);

    if (!normalizeNotificationPreferences(data).enabled) {
      return "disabled" as const;
    }

    if (lastNudgeDayKey(data, kind) === dayKey) {
      return "already-sent" as const;
    }

    if (
      claim.dayKey === dayKey &&
      claim.claimId &&
      claim.claimedAt !== null &&
      now - claim.claimedAt < DIGEST_CLAIM_TTL_MS
    ) {
      return "already-claimed" as const;
    }

    transaction.set(
      preferencesRef,
      {
        [fields.claimDayKey]: dayKey,
        ...(fields.legacyClaimDayKey ? { [fields.legacyClaimDayKey]: null } : {}),
        [fields.claimId]: claimId,
        [fields.claimedAt]: now,
        updatedAt: now,
      },
      { merge: true }
    );

    return "claimed" as const;
  });
}

async function finalizeNudge(
  adminDb: ReturnType<typeof getAdminDb>,
  preferencesRef: FirebaseFirestore.DocumentReference,
  kind: NudgeKind,
  dayKey: string,
  claimId: string,
  now: number,
  markSent: boolean
) {
  const fields = NUDGE_FIELDS[kind];
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(preferencesRef);
    const data = (snapshot.data() as Record<string, unknown> | undefined) ?? {};
    const claim = getNudgeClaim(data, kind);

    if (claim.dayKey !== dayKey || claim.claimId !== claimId) {
      return false;
    }

    const lastSentAt = data[fields.lastSentAt];
    transaction.set(
      preferencesRef,
      {
        [fields.claimDayKey]: null,
        ...(fields.legacyClaimDayKey ? { [fields.legacyClaimDayKey]: null } : {}),
        [fields.claimId]: null,
        [fields.claimedAt]: null,
        [fields.lastDayKey]: markSent ? dayKey : lastNudgeDayKey(data, kind),
        [fields.lastSentAt]: markSent ? now : typeof lastSentAt === "number" ? lastSentAt : null,
        updatedAt: now,
      },
      { merge: true }
    );

    return true;
  });
}

/**
 * Records that a nudge was looked at for the day and had nothing to say, or
 * nowhere to go, so the hourly runs that follow do not read the student's
 * cards again for it.
 */
async function markNudgeChecked(
  preferencesRef: FirebaseFirestore.DocumentReference,
  kind: NudgeKind,
  dayKey: string
) {
  await preferencesRef.set({ [NUDGE_FIELDS[kind].lastDayKey]: dayKey }, { merge: true });
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
  input: { now: number },
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

  const preferences = normalizeNotificationPreferences(
    preferencesDoc.data() as Record<string, unknown>
  );
  // Most runs reach most students outside their own nudge times; those cost
  // nothing beyond the preferences already read.
  const due = getDueNudge(preferences, input.now);
  if (!due) {
    result.skipped = 1;
    return result;
  }

  try {
    const [requiredDailyCount, urgentGoalCount, subscriptionsSnapshot] =
      await Promise.all([
        countRequiredDailyReviewCards(
          dependencies.adminDb,
          userId,
          input.now
        ),
        due.kind === "digest" ? countUrgentGoals(dependencies.adminDb, userId, input.now) : 0,
        dependencies.adminDb
          .collection("users")
          .doc(userId)
          .collection("pushSubscriptions")
          .get(),
      ]);
    const payload =
      due.kind === "digest"
        ? buildDigestPayload(requiredDailyCount, urgentGoalCount, preferences.mode)
        : buildEveningReminderPayload(requiredDailyCount);

    if (!payload || subscriptionsSnapshot.empty) {
      await markNudgeChecked(preferencesDoc.ref, due.kind, due.dayKey);
      result.skipped = 1;
      return result;
    }

    claimId = dependencies.createClaimId();
    const claimResult = await claimNudge(
      dependencies.adminDb,
      preferencesDoc.ref,
      due.kind,
      due.dayKey,
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
          const finalized = await finalizeNudge(
            dependencies.adminDb,
            preferencesDoc.ref,
            due.kind,
            due.dayKey,
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
        await finalizeNudge(
          dependencies.adminDb,
          preferencesDoc.ref,
          due.kind,
          due.dayKey,
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

/**
 * One hourly run: every student with notifications on gets whichever nudge is
 * due by their own clock, if any.
 */
export async function runNotificationDigest(
  input: {
    now: number;
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
