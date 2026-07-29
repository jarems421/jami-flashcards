/**
 * Decodes a stored push subscription document into the shape
 * `sendPushNotification` accepts. Both the digest route and the test route read
 * the same `pushSubscriptions` documents, so the validation lives here.
 */
export type PushSubscriptionRecord = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};

export function hasValidSubscription(data: Record<string, unknown>) {
  return (
    typeof data.endpoint === "string" &&
    !!data.endpoint &&
    typeof data.keys === "object" &&
    data.keys !== null &&
    typeof (data.keys as { auth?: unknown }).auth === "string" &&
    typeof (data.keys as { p256dh?: unknown }).p256dh === "string"
  );
}

export function toPushRecord(
  data: Record<string, unknown>
): PushSubscriptionRecord | null {
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
