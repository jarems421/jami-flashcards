import type { NextRequest } from "next/server";
import { normalizeGoal } from "@/lib/study/goals";
import { normalizeNotificationPreferences } from "@/lib/app/notifications";
import { getAdminDb } from "@/services/firebase/admin";
import {
  isExpiredPushSubscriptionError,
  sendPushNotification,
} from "@/services/notifications/web-push";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;
const DIGEST_CLAIM_TTL_MS = 10 * 60 * 1000;

function getUtcDayKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function getDigestClaim(data: Record<string, unknown>) {
  return {
    dayKey:
      typeof data.digestClaimDayKey === "string" ? data.digestClaimDayKey : null,
    claimId: typeof data.digestClaimId === "string" ? data.digestClaimId : null,
    claimedAt:
      typeof data.digestClaimedAt === "number" && Number.isFinite(data.digestClaimedAt)
        ? data.digestClaimedAt
        : null,
  };
}

function hasValidSubscription(data: Record<string, unknown>) {
  return (
    typeof data.endpoint === "string" &&
    !!data.endpoint &&
    typeof data.keys === "object" &&
    data.keys !== null &&
    typeof (data.keys as { auth?: unknown }).auth === "string" &&
    typeof (data.keys as { p256dh?: unknown }).p256dh === "string"
  );
}

function toPushRecord(data: Record<string, unknown>) {
  if (!hasValidSubscription(data)) {
    return null;
  }

  return {
    endpoint: data.endpoint as string,
    expirationTime:
      typeof data.expirationTime === "number" ? data.expirationTime : null,
    keys: {
      auth: (data.keys as { auth: string }).auth,
      p256dh: (data.keys as { p256dh: string }).p256dh,
    },
  };
}

function buildDigestPayload(
  dueCount: number,
  urgentGoalCount: number,
  includeDailyNudge: boolean
) {
  const parts: string[] = [];

  if (dueCount > 0) {
    parts.push(`${dueCount} card${dueCount === 1 ? "" : "s"} due`);
  }

  if (urgentGoalCount > 0) {
    parts.push(
      `${urgentGoalCount} goal${urgentGoalCount === 1 ? "" : "s"} need${urgentGoalCount === 1 ? "s" : ""} attention`
    );
  }

  if (parts.length > 0) {
    return {
      title: "Daily study digest",
      body: parts.join(" • "),
      url: dueCount > 0 ? "/dashboard" : "/dashboard/goals",
      tag: "daily-digest",
      icon: "/icons/notification-icon-192.png",
      badge: "/icons/notification-icon-192.png",
    };
  }

  if (!includeDailyNudge) {
    return null;
  }

  return {
    title: "Time to study",
    body: "Take a few minutes to review today.",
    url: "/dashboard",
    tag: "daily-digest",
    icon: "/icons/notification-icon-192.png",
    badge: "/icons/notification-icon-192.png",
  };
}

async function claimDigestWindow(
  adminDb: ReturnType<typeof getAdminDb>,
  preferencesRef: FirebaseFirestore.DocumentReference,
  dayKey: string,
  claimId: string,
  now: number
) {
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(preferencesRef);
    const data = (snapshot.data() as Record<string, unknown> | undefined) ?? {};
    const preferences = normalizeNotificationPreferences(data);
    const digestClaim = getDigestClaim(data);

    if (preferences.lastDigestDayKey === dayKey) {
      return "already-sent" as const;
    }

    if (
      digestClaim.dayKey === dayKey &&
      digestClaim.claimId &&
      digestClaim.claimedAt !== null &&
      now - digestClaim.claimedAt < DIGEST_CLAIM_TTL_MS
    ) {
      return "already-claimed" as const;
    }

    transaction.set(
      preferencesRef,
      {
        digestClaimDayKey: dayKey,
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
  dayKey: string,
  claimId: string,
  now: number,
  markSent: boolean
) {
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(preferencesRef);
    const data = (snapshot.data() as Record<string, unknown> | undefined) ?? {};
    const digestClaim = getDigestClaim(data);

    if (digestClaim.dayKey !== dayKey || digestClaim.claimId !== claimId) {
      return false;
    }

    transaction.set(
      preferencesRef,
      {
        digestClaimDayKey: null,
        digestClaimId: null,
        digestClaimedAt: null,
        lastDigestDayKey: markSent ? dayKey : data.lastDigestDayKey ?? null,
        lastDigestSentAt: markSent ? now : data.lastDigestSentAt ?? null,
        updatedAt: now,
      },
      { merge: true }
    );

    return true;
  });
}

async function countDueCards(userId: string, now: number) {
  const adminDb = getAdminDb();
  const cardsSnapshot = await adminDb
    .collection("cards")
    .where("userId", "==", userId)
    .get();

  let dueCount = 0;

  for (const cardDoc of cardsSnapshot.docs) {
    const dueDate = cardDoc.get("dueDate");
    if (typeof dueDate !== "number" || dueDate <= now) {
      dueCount += 1;
    }
  }

  return dueCount;
}

async function countUrgentGoals(userId: string, now: number) {
  const adminDb = getAdminDb();
  const goalsSnapshot = await adminDb
    .collection("users")
    .doc(userId)
    .collection("goals")
    .where("status", "==", "active")
    .get();

  let urgentGoalCount = 0;

  for (const goalDoc of goalsSnapshot.docs) {
    const goal = normalizeGoal(
      goalDoc.id,
      goalDoc.data() as Record<string, unknown>
    );

    if (goal.deadline <= now + DAY_MS) {
      urgentGoalCount += 1;
    }
  }

  return urgentGoalCount;
}

export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = Date.now();
  const dayKey = getUtcDayKey(now);

  try {
    const adminDb = getAdminDb();
    const preferencesSnapshot = await adminDb
      .collectionGroup("notificationPreferences")
      .where("enabled", "==", true)
      .get();

    let considered = 0;
    let claimed = 0;
    let sent = 0;
    let removed = 0;
    let skipped = 0;

    for (const preferencesDoc of preferencesSnapshot.docs) {
      const userRef = preferencesDoc.ref.parent.parent;
      const userId = userRef?.id;

      if (!userId) {
        skipped += 1;
        continue;
      }

      considered += 1;

      const preferences = normalizeNotificationPreferences(
        preferencesDoc.data() as Record<string, unknown>
      );

      const [dueCount, urgentGoalCount, subscriptionsSnapshot] = await Promise.all([
        countDueCards(userId, now),
        countUrgentGoals(userId, now),
        adminDb.collection("users").doc(userId).collection("pushSubscriptions").get(),
      ]);

      const payload = buildDigestPayload(
        preferences.dueCardDigest ? dueCount : 0,
        preferences.goalDigest ? urgentGoalCount : 0,
        preferences.dailyNudge
      );

      if (!payload || subscriptionsSnapshot.empty) {
        skipped += 1;
        continue;
      }

      const claimId = crypto.randomUUID();
      const claimResult = await claimDigestWindow(
        adminDb,
        preferencesDoc.ref,
        dayKey,
        claimId,
        now
      );
      if (claimResult !== "claimed") {
        skipped += 1;
        continue;
      }

      claimed += 1;
      let markedSent = false;

      for (const subscriptionDoc of subscriptionsSnapshot.docs) {
        const subscriptionData = subscriptionDoc.data() as Record<string, unknown>;

        const subscription = toPushRecord(subscriptionData);

        if (!subscription) {
          await subscriptionDoc.ref.delete();
          removed += 1;
          continue;
        }

        try {
          await sendPushNotification(subscription, payload);

          sent += 1;

          if (!markedSent) {
            const finalized = await finalizeDigestWindow(
              adminDb,
              preferencesDoc.ref,
              dayKey,
              claimId,
              Date.now(),
              true
            );
            markedSent = finalized;
          }
        } catch (error) {
          if (isExpiredPushSubscriptionError(error)) {
            await subscriptionDoc.ref.delete();
            removed += 1;
            continue;
          }

          console.error(error);
        }
      }

      if (!markedSent) {
        await finalizeDigestWindow(
          adminDb,
          preferencesDoc.ref,
          dayKey,
          claimId,
          Date.now(),
          false
        );
      }
    }

    return Response.json({
      ok: true,
      dayKey,
      considered,
      claimed,
      sent,
      removed,
      skipped,
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown digest error",
      },
      { status: 500 }
    );
  }
}
