import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setIsSupported(supported);
    
    if (supported) {
      setPermission(Notification.permission);
      checkSubscription();
    }
  }, []);

  const checkSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch (e) {
      console.error("Failed to check subscription:", e);
    }
  };

  const subscribe = useCallback(async () => {
    if (!isSupported) {
      setError("Push notifications are not supported on this device");
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      
      if (perm !== "granted") {
        setError("Notification permission denied");
        setIsLoading(false);
        return false;
      }

      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;

      const response = await fetch("/api/push/vapid-public-key");
      const { publicKey } = await response.json();
      
      if (!publicKey) {
        setError("Push notifications not configured on server");
        setIsLoading(false);
        return false;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      const subJson = subscription.toJSON();
      await apiRequest("POST", "/api/push/subscribe", {
        endpoint: subJson.endpoint,
        keys: subJson.keys
      });

      setIsSubscribed(true);
      setIsLoading(false);
      return true;
    } catch (e: any) {
      console.error("Push subscription failed:", e);
      setError(e.message || "Failed to enable notifications");
      setIsLoading(false);
      return false;
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        const subJson = subscription.toJSON();
        await subscription.unsubscribe();
        await apiRequest("DELETE", "/api/push/subscribe", {
          endpoint: subJson.endpoint
        });
      }

      setIsSubscribed(false);
      setIsLoading(false);
      return true;
    } catch (e: any) {
      console.error("Push unsubscribe failed:", e);
      setError(e.message || "Failed to disable notifications");
      setIsLoading(false);
      return false;
    }
  }, []);

  const sendTestNotification = useCallback(async () => {
    try {
      const res = await apiRequest("POST", "/api/push/test");
      return res.ok;
    } catch (e) {
      console.error("Test notification failed:", e);
      return false;
    }
  }, []);

  return {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    error,
    subscribe,
    unsubscribe,
    sendTestNotification
  };
}
