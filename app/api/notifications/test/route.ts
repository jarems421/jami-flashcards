import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase-admin";
import {
  isExpiredPushSubscriptionError,
  sendPushNotification,
} from "@/services/web-push";

export const runtime = "nodejs";

function getBearerToken(header: string | null) {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown notification error";
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
    const adminDb = getAdminDb();
    const subscriptionsSnapshot = await adminDb
      .collection("users")
      .doc(uid)
      .collection("pushSubscriptions")
      .get();

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
            icon: "/icon",
            badge: "/icon",
          }
        );

        sent += 1;
      } catch (error) {
        if (isExpiredPushSubscriptionError(error)) {
          await subscriptionDoc.ref.delete();
          removed += 1;
          continue;
        }

        console.error(error);
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
    console.error(error);

    return Response.json(
      {
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}