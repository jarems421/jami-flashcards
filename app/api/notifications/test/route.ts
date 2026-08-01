import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import { toPushRecord } from "@/lib/app/push-subscriptions";
import {
  isExpiredPushSubscriptionError,
  sendPushNotification,
} from "@/services/notifications/web-push";

export const runtime = "nodejs";

function logNotificationError(label: string, error: unknown) {
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : undefined;
  const message =
    error instanceof Error
      ? error.message
          .replace(/https?:\/\/\S+/gi, "[url]")
          .replace(/[\r\n]+/g, " ")
          .slice(0, 180)
      : "Unknown notification error";
  console.error(label, { statusCode, message });
}

export async function POST(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));

  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;

  try {
    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let requestedSubscriptionId: string | null = null;
    const rawBody = await request.text();
    if (rawBody.trim()) {
      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(rawBody) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Invalid notification test body.");
        }
        body = parsed as Record<string, unknown>;
      } catch {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }

      if (
        "subscriptionId" in body &&
        body.subscriptionId !== null &&
        typeof body.subscriptionId !== "string"
      ) {
        return Response.json({ error: "Invalid subscription id" }, { status: 400 });
      }

      const candidate =
        typeof body.subscriptionId === "string"
          ? body.subscriptionId.trim()
          : "";
      if (candidate.length > 256 || candidate.includes("/")) {
        return Response.json({ error: "Invalid subscription id" }, { status: 400 });
      }
      requestedSubscriptionId = candidate || null;
    }

    const adminDb = getAdminDb();
    const subscriptionsCollection = adminDb
      .collection("users")
      .doc(uid)
      .collection("pushSubscriptions");

    if (requestedSubscriptionId) {
      const subscriptionDoc = await subscriptionsCollection
        .doc(requestedSubscriptionId)
        .get();

      if (!subscriptionDoc.exists) {
        return Response.json(
          { error: "This device is not subscribed anymore. Enable notifications again.", sent: 0 },
          { status: 400 }
        );
      }

      const subscription = toPushRecord(
        subscriptionDoc.data() as Record<string, unknown>
      );

      if (!subscription) {
        await subscriptionDoc.ref.delete();
        return Response.json(
          { error: "This device had an invalid subscription. Enable notifications again.", sent: 0, removed: 1 },
          { status: 400 }
        );
      }

      try {
        await sendPushNotification(
          subscription,
          {
            title: "Jami Flashcards",
            body: "Test notification from this device.",
            url: "/dashboard/profile",
            tag: "notification-test",
            icon: "/icons/notification-icon-192.png",
            badge: "/icons/notification-icon-192.png",
          }
        );

        return Response.json({ ok: true, sent: 1, removed: 0, failed: 0 });
      } catch (error) {
        if (isExpiredPushSubscriptionError(error)) {
          await subscriptionDoc.ref.delete();
          return Response.json(
            { error: "This device subscription expired. Enable notifications again.", sent: 0, removed: 1, failed: 0 },
            { status: 400 }
          );
        }

        logNotificationError("Targeted test notification failed.", error);
        return Response.json(
          {
            error: "The notification provider could not deliver this test just now.",
            sent: 0,
            removed: 0,
            failed: 1,
          },
          { status: 502 }
        );
      }
    }

    const subscriptionsSnapshot = await subscriptionsCollection.get();

    if (subscriptionsSnapshot.empty) {
      return Response.json(
        { error: "Enable notifications on at least one device first." },
        { status: 400 }
      );
    }

    let sent = 0;
    let removed = 0;
    let failed = 0;

    for (const subscriptionDoc of subscriptionsSnapshot.docs) {
      const data = subscriptionDoc.data() as Record<string, unknown>;
      const subscription = toPushRecord(data);
      if (!subscription) {
        await subscriptionDoc.ref.delete();
        removed += 1;
        continue;
      }

      try {
        await sendPushNotification(
          subscription,
          {
            title: "Jami Flashcards",
            body: "Test notification from your installed app.",
            url: "/dashboard/profile",
            tag: "notification-test",
            icon: "/icons/notification-icon-192.png",
            badge: "/icons/notification-icon-192.png",
          }
        );

        sent += 1;
      } catch (error) {
        if (isExpiredPushSubscriptionError(error)) {
          await subscriptionDoc.ref.delete();
          removed += 1;
          continue;
        }

        logNotificationError("Test notification delivery failed.", error);
        failed += 1;
      }
    }

    if (sent === 0 && removed > 0 && failed === 0) {
      return Response.json(
        {
          error: "No active subscriptions remain. Re-enable notifications on this device.",
          sent,
          removed,
          failed,
        },
        { status: 400 }
      );
    }

    return Response.json({
      ok: sent > 0,
      sent,
      removed,
      failed,
    });
  } catch (error) {
    logNotificationError("Test notification route failed.", error);

    return Response.json(
      {
        error: "Test notifications are temporarily unavailable.",
      },
      { status: 500 }
    );
  }
}
