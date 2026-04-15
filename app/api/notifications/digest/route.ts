import type { NextRequest } from "next/server";
import { normalizeGoal } from "@/lib/study/goals";
import {
  normalizeNotificationPreferences,
  type NotificationMode,
} from "@/lib/app/notifications";
import { buildDailyReviewQueues } from "@/lib/study/daily-review";
import {
  getStudyDayKey,
  getStudyDayWindow,
  isWithinStudyDayBoundaryWindow,
} from "@/lib/study/day";
import { mapCardData } from "@/lib/study/cards";
import { getAdminDb } from "@/services/firebase/admin";
import {
  isExpiredPushSubscriptionError,
  sendPushNotification,
} from "@/services/notifications/web-push";

export const runtime = "nodejs";

const DIGEST_CLAIM_TTL_MS = 10 * 60 * 1000;

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
  requiredDailyCount: number,
  urgentGoalCount: number,
  mode: NotificationMode
) {
  const parts: string[] = [];

  if (requiredDailyCount > 0) {
    parts.push(
      `${requiredDailyCount} required Daily Review card${requiredDailyCount === 1 ? "" : "s"}`
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
      url: requiredDailyCount > 0 ? "/dashboard/study?mode=daily" : "/dashboard/goals",
      tag: "daily-digest",
      icon: "/icons/notification-icon-192.png",
      badge: "/icons/notification-icon-192.png",
    };
  }

  if (mode !== "always") {
    return null;
  }

  return {
    title: "Study window is open",
    body: "Daily Review is clear. Use Custom Review or tidy up your decks.",
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

    if (digestClaim.studyDayKey !== studyDayKey || digestClaim.claimId !== claimId) {
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

async function countRequiredDailyReviewCards(userId: string, now: number) {
  const adminDb = getAdminDb();
  const cardsSnapshot = await adminDb
    .collection("cards")
    .where("userId", "==", userId)
    .get();

  const cards = cardsSnapshot.docs.map((cardDoc) =>
    mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>)
  );

  return buildDailyReviewQueues(cards, now).requiredCards.length;
}

async function countUrgentGoals(userId: string, now: number) {
  const adminDb = getAdminDb();
  const { end } = getStudyDayWindow(now);
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

    if (goal.deadline <= end) {
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
  const studyDayKey = getStudyDayKey(now);

  if (!isWithinStudyDayBoundaryWindow(now, 20 * 60 * 1000)) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "outside-study-window",
      studyDayKey,
    });
  }

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

      const [requiredDailyCount, urgentGoalCount, subscriptionsSnapshot] =
        await Promise.all([
          countRequiredDailyReviewCards(userId, now),
          countUrgentGoals(userId, now),
          adminDb.collection("users").doc(userId).collection("pushSubscriptions").get(),
        ]);

      const payload = buildDigestPayload(
        requiredDailyCount,
        urgentGoalCount,
        preferences.mode
      );

      if (!payload || subscriptionsSnapshot.empty) {
        skipped += 1;
        continue;
      }

      const claimId = crypto.randomUUID();
      const claimResult = await claimDigestWindow(
        adminDb,
        preferencesDoc.ref,
        studyDayKey,
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
              studyDayKey,
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
          studyDayKey,
          claimId,
          Date.now(),
          false
        );
      }
    }

    return Response.json({
      ok: true,
      studyDayKey,
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
