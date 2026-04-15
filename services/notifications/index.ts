import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
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
} from "@/lib/app/notifications";

const LOAD_MS = 15_000;
const SAVE_MS = 15_000;
const SERVICE_WORKER_READY_MS = 10_000;

function hasCompletePushKeys(subscription: PushSubscriptionJSON) {
  return Boolean(subscription.keys?.auth && subscription.keys.p256dh);
}

function applicationServerKeysMatch(
  existingKey: ArrayBuffer | null,
  expectedKey: Uint8Array
) {
  if (!existingKey) {
    return true;
  }

  const existingBytes = new Uint8Array(existingKey);
  if (existingBytes.length !== expectedKey.length) {
    return false;
  }

  return existingBytes.every((value, index) => value === expectedKey[index]);
}

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

  let registration = await navigator.serviceWorker.getRegistration("/");

  if (!registration) {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  }

  await registration.update().catch(() => undefined);
  return withTimeout(
    navigator.serviceWorker.ready,
    SERVICE_WORKER_READY_MS,
    "Wait for service worker"
  );
}

async function ensureNotificationPreferencesDocument(userId: string) {
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

  if (snapshot.exists()) {
    return;
  }

  await withTimeout(
    setDoc(preferencesRef, {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      updatedAt: Date.now(),
    }),
    SAVE_MS,
    "Create notification preferences"
  );
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
    const nextPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      updatedAt: Date.now(),
    } satisfies NotificationPreferences;

    await ensureUserProfileDocument(userId);
    await withTimeout(
      setDoc(preferencesRef, nextPreferences),
      SAVE_MS,
      "Create notification preferences"
    );

    return nextPreferences;
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
  if (!hasCompletePushKeys(payload)) {
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

  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  let subscription = await registration.pushManager.getSubscription();

  if (
    subscription &&
    !applicationServerKeysMatch(
      subscription.options.applicationServerKey,
      applicationServerKey
    )
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }

  if (subscription && !hasCompletePushKeys(subscription.toJSON())) {
    await subscription.unsubscribe();
    subscription = null;
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  const payload = subscription.toJSON();
  const endpoint = payload.endpoint ?? subscription.endpoint;
  if (!endpoint) {
    throw new Error("The browser did not return a valid push subscription endpoint.");
  }
  if (!hasCompletePushKeys(payload)) {
    throw new Error("The browser returned an incomplete push subscription. Reinstall the app and try again.");
  }

  const subscriptionId = await createPushSubscriptionId(endpoint);
  const nextRecord = buildStoredPushSubscription(
    subscriptionId,
    payload,
    navigator.userAgent,
    isStandaloneApp() ? "standalone" : "browser"
  );

  await ensureUserProfileDocument(userId);
  await ensureNotificationPreferencesDocument(userId);
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
