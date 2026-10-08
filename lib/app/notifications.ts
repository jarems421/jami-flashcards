import { isKnownTimeZone } from "@/lib/study/day";

export type NotificationMode = "smart" | "always";

export type NotificationPreferences = {
  enabled: boolean;
  mode: NotificationMode;
  /** The student's own time zone, from their device; null means study time (London). */
  timeZone: string | null;
  /** A second nudge in the evening while Daily Review is still waiting. */
  eveningReminder: boolean;
  updatedAt: number;
  lastDigestStudyDayKey: string | null;
  lastDigestSentAt: number | null;
  lastEveningReminderDayKey: string | null;
  lastEveningReminderSentAt: number | null;
};

/** What a student sets. The rest is the server's record of what it has sent. */
export type NotificationSettings = Pick<NotificationPreferences, "enabled" | "mode" | "timeZone" | "eveningReminder">;

export type StoredPushSubscription = {
  id: string;
  endpoint: string;
  expirationTime: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
  userAgent: string;
  installationMode: "browser" | "standalone";
  createdAt: number;
  updatedAt: number;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  mode: "smart",
  timeZone: null,
  eveningReminder: true,
  updatedAt: 0,
  lastDigestStudyDayKey: null,
  lastDigestSentAt: null,
  lastEveningReminderDayKey: null,
  lastEveningReminderSentAt: null,
};

/** This device's time zone, if the browser will say and it is one the app knows. */
export function getDeviceTimeZone(): string | null {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isKnownTimeZone(timeZone) ? timeZone : null;
  } catch {
    return null;
  }
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeNotificationPreferences(
  data: Record<string, unknown> | null | undefined
): NotificationPreferences {
  const legacyAlwaysMode =
    typeof data?.mode === "string"
      ? data.mode
      : asBoolean(data?.dailyNudge, false)
        ? "always"
        : "smart";
  // Early preferences kept the device's zone as `timezone`.
  const timeZone = isKnownTimeZone(data?.timeZone) ? data?.timeZone : data?.timezone;

  return {
    enabled: asBoolean(data?.enabled, DEFAULT_NOTIFICATION_PREFERENCES.enabled),
    mode:
      legacyAlwaysMode === "always"
        ? "always"
        : DEFAULT_NOTIFICATION_PREFERENCES.mode,
    timeZone: isKnownTimeZone(timeZone) ? timeZone : null,
    eveningReminder: asBoolean(data?.eveningReminder, DEFAULT_NOTIFICATION_PREFERENCES.eveningReminder),
    updatedAt: asNumber(data?.updatedAt) ?? 0,
    lastDigestStudyDayKey:
      typeof data?.lastDigestStudyDayKey === "string"
        ? data.lastDigestStudyDayKey
        : typeof data?.lastDigestDayKey === "string"
          ? data.lastDigestDayKey
          : null,
    lastDigestSentAt: asNumber(data?.lastDigestSentAt),
    lastEveningReminderDayKey:
      typeof data?.lastEveningReminderDayKey === "string" ? data.lastEveningReminderDayKey : null,
    lastEveningReminderSentAt: asNumber(data?.lastEveningReminderSentAt),
  };
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isSecureNotificationContext() {
  return typeof window !== "undefined" && window.isSecureContext;
}

export function isAppleMobileDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = navigator.platform ?? "";
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandaloneApp() {
  if (typeof window === "undefined") {
    return false;
  }

  const navigatorStandalone =
    typeof navigator !== "undefined" && "standalone" in navigator
      ? Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
      : false;

  return window.matchMedia("(display-mode: standalone)").matches || navigatorStandalone;
}

export function getNotificationPermissionState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  return Notification.permission;
}

export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(normalized);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

export async function createPushSubscriptionId(endpoint: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(endpoint)
  );

  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function buildStoredPushSubscription(
  id: string,
  subscription: PushSubscriptionJSON,
  userAgent: string,
  installationMode: "browser" | "standalone"
): StoredPushSubscription {
  return {
    id,
    endpoint: subscription.endpoint ?? "",
    expirationTime:
      typeof subscription.expirationTime === "number"
        ? subscription.expirationTime
        : null,
    keys: {
      auth: subscription.keys?.auth ?? "",
      p256dh: subscription.keys?.p256dh ?? "",
    },
    userAgent,
    installationMode,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
