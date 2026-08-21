import "server-only";

import { normalizeNotificationPreferences } from "@/lib/app/notifications";
import { toPushRecord } from "@/lib/app/push-subscriptions";
import { createLogger } from "@/lib/observability/logger";
import { getAdminDb } from "@/services/firebase/admin";
import {
  isExpiredPushSubscriptionError,
  sendPushNotification,
} from "@/services/notifications/web-push";

export async function notifyPracticePaperMarkingReady(
  uid: string,
  paperId: string,
  title: string
) {
  const userRef = getAdminDb().collection("users").doc(uid);
  const [preferencesSnapshot, subscriptions] = await Promise.all([
    userRef.collection("notificationPreferences").doc("config").get(),
    userRef.collection("pushSubscriptions").get(),
  ]);
  const preferences = normalizeNotificationPreferences(preferencesSnapshot.data() ?? {});
  if (!preferences.enabled || subscriptions.empty) return;
  const log = createLogger({ service: "practice-paper-ready", uid });
  await Promise.all(subscriptions.docs.map(async (document) => {
    const subscription = toPushRecord(document.data());
    if (!subscription) return document.ref.delete();
    try {
      await sendPushNotification(subscription, {
        title: "Your marked paper is ready",
        body: title,
        url: `/dashboard/notebooks/${encodeURIComponent(paperId)}`,
        tag: `practice-paper-marked-${paperId}`,
        icon: "/icons/notification-icon-192.png",
        badge: "/icons/notification-icon-192.png",
      });
    } catch (error) {
      if (isExpiredPushSubscriptionError(error)) return document.ref.delete();
      log.warn("push.send_failed", { error });
    }
  }));
}
