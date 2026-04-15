import "server-only";

import webpush from "web-push";

let configured = false;

type PushRecord = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};

function configureWebPush() {
  if (configured) {
    return webpush;
  }

  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();

  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      "Missing Web Push environment variables. Configure NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_SUBJECT."
    );
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;

  return webpush;
}

export async function sendPushNotification(
  subscription: PushRecord,
  payload: Record<string, unknown>
) {
  const client = configureWebPush();

  return client.sendNotification(
    {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: subscription.keys,
    },
    JSON.stringify(payload),
    {
      TTL: 60 * 60 * 12,
      urgency: "normal",
      // Keep notification grouping inside the service worker payload. Safari/iPad
      // can reject the optional Web Push Topic header with BadWebPushTopic.
    }
  );
}

export function isExpiredPushSubscriptionError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (((error as { statusCode?: number }).statusCode ?? 0) === 404 ||
      ((error as { statusCode?: number }).statusCode ?? 0) === 410)
  );
}
