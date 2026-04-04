import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "@/services/firebase";
import { withTimeout } from "@/services/firestore";
import {
  buildStoredPushSubscription,
  createPushSubscriptionId,
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPermissionState,
  isPushSupported,
  isStandaloneApp,
  normalizeNotificationPreferences,
  type NotificationPreferences,
  urlBase64ToUint8Array,
} from "@/lib/notifications";

const LOAD_MS = 15_000;
const SAVE_MS = 15_000;

async function ensureUserProfileDocument(userId: string) {
  const userRef = doc(db, "users", userId);
  const snapshot = await withTimeout(getDoc(userRef), LOAD_MS, "Load user profile");

  if (snapshot.exists()) {
    return;
  }

  await withTimeout(
    setDoc(userRef, { createdAt: Date.now() }),
    SAVE_MS,
    "Create user profile"
  );
}

export async function ensureServiceWorkerRegistration() {
  if (!isPushSupported()) {
    return null;
  }

  let registration = await navigator.serviceWorker.getRegistration();

  if (!registration) {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  }

  await navigator.serviceWorker.ready;
  return registration;
}

export async function loadNotificationPreferences(userId: string) {
  const preferencesRef = doc(
    db,
    "users",
    userId,
    "notificationPreferences",
    "config"
  );
  const snapshot = await withTimeout(
    getDoc(preferencesRef),
    LOAD_MS,
    "Load notification preferences"
  );

  if (!snapshot.exists()) {
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      timezone:
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
          : "UTC",
    } satisfies NotificationPreferences;
  }

  return normalizeNotificationPreferences(
    snapshot.data() as Record<string, unknown>
  );
}

export async function saveNotificationPreferences(
  userId: string,
  preferences: NotificationPreferences
) {
  await ensureUserProfileDocument(userId);

  const nextPreferences: NotificationPreferences = {
    ...normalizeNotificationPreferences(preferences),
    updatedAt: Date.now(),
  };

  await withTimeout(
    setDoc(
      doc(db, "users", userId, "notificationPreferences", "config"),
      nextPreferences,
      { merge: true }
    ),
    SAVE_MS,
    "Save notification preferences"
  );

  return nextPreferences;
}

export async function getCurrentDevicePushSubscription() {
  if (!isPushSupported()) {
    return null;
  }

  const registration = await ensureServiceWorkerRegistration();
  if (!registration) {
    return null;
  }

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return null;
  }

  const payload = subscription.toJSON();
  const endpoint = payload.endpoint ?? subscription.endpoint;
  if (!endpoint) {
    return null;
  }

  const subscriptionId = await createPushSubscriptionId(endpoint);

  return buildStoredPushSubscription(
    subscriptionId,
    payload,
    navigator.userAgent,
    isStandaloneApp() ? "standalone" : "browser"
  );
}

export async function subscribeCurrentDevice(userId: string) {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported on this device.");
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  if (!vapidPublicKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY in the app configuration."
    );
  }

  const permission = getNotificationPermissionState();
  if (permission === "denied") {
    throw new Error("Notifications are blocked. Re-enable them in browser or device settings.");
  }

  const nextPermission = await Notification.requestPermission();
  if (nextPermission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await ensureServiceWorkerRegistration();
  if (!registration) {
    throw new Error("Service worker registration is unavailable on this device.");
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const payload = subscription.toJSON();
  const endpoint = payload.endpoint ?? subscription.endpoint;
  if (!endpoint) {
    throw new Error("The browser did not return a valid push subscription endpoint.");
  }

  const subscriptionId = await createPushSubscriptionId(endpoint);
  const nextRecord = buildStoredPushSubscription(
    subscriptionId,
    payload,
    navigator.userAgent,
    isStandaloneApp() ? "standalone" : "browser"
  );

  await ensureUserProfileDocument(userId);
  await withTimeout(
    setDoc(
      doc(db, "users", userId, "pushSubscriptions", subscriptionId),
      nextRecord,
      { merge: true }
    ),
    SAVE_MS,
    "Save push subscription"
  );

  return nextRecord;
}

export async function unsubscribeCurrentDevice(userId: string) {
  if (!isPushSupported()) {
    return;
  }

  const registration = await ensureServiceWorkerRegistration();
  if (!registration) {
    return;
  }

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return;
  }

  const payload = subscription.toJSON();
  const endpoint = payload.endpoint ?? subscription.endpoint;
  const subscriptionId = endpoint
    ? await createPushSubscriptionId(endpoint)
    : null;

  await subscription.unsubscribe();

  if (!subscriptionId) {
    return;
  }

  await withTimeout(
    deleteDoc(doc(db, "users", userId, "pushSubscriptions", subscriptionId)),
    SAVE_MS,
    "Delete push subscription"
  );
}