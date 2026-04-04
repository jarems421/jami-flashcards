"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isAppleMobileDevice,
  isPushSupported,
  isStandaloneApp,
  type NotificationPreferences,
  type NotificationPreferenceField,
} from "@/lib/notifications";
import {
  getCurrentDevicePushSubscription,
  loadNotificationPreferences,
  saveNotificationPreferences,
  subscribeCurrentDevice,
  unsubscribeCurrentDevice,
} from "@/services/notifications";
import { auth } from "@/services/firebase";
import { getNotificationPermissionState } from "@/lib/notifications";

type Feedback = {
  type: "error" | "success";
  message: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

const TOGGLE_FIELDS: Array<{
  field: NotificationPreferenceField;
  label: string;
  description: string;
}> = [
  {
    field: "dueCardDigest",
    label: "Include due cards",
    description: "Summarize how many review cards are waiting for you.",
  },
  {
    field: "goalDigest",
    label: "Include urgent goals",
    description: "Call out active goals that are due soon or due today.",
  },
  {
    field: "dailyNudge",
    label: "Fallback daily nudge",
    description: "Send a light study prompt when nothing urgent is waiting.",
  },
];

export default function NotificationSettingsCard({
  userId,
}: {
  userId: string;
}) {
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES
  );
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [installPromptEvent, setInstallPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isAppleMobile, setIsAppleMobile] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [clientStateError, setClientStateError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported"
  );

  const refreshClientState = useCallback(async () => {
    const supported = isPushSupported();
    setIsSupported(supported);
    setIsAppleMobile(isAppleMobileDevice());
    setIsStandalone(isStandaloneApp());
    setPermission(getNotificationPermissionState());

    if (!supported) {
      setHasSubscription(false);
      setClientStateError(null);
      return;
    }

    try {
      const subscription = await getCurrentDevicePushSubscription();
      setHasSubscription(Boolean(subscription));
      setClientStateError(null);
    } catch (error) {
      console.error(error);
      setHasSubscription(false);
      setClientStateError(
        "This device could not finish notification setup. Reload the app and try again."
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const nextPreferences = await loadNotificationPreferences(userId);
        if (!cancelled) {
          setPreferences(nextPreferences);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setFeedback({
            type: "error",
            message: "Failed to load notification settings.",
          });
        }
      } finally {
        if (!cancelled) {
          await refreshClientState();
          setLoading(false);
        }
      }
    })();

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleStandaloneChange = () => {
      void refreshClientState();
    };
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
      void refreshClientState();
    };

    mediaQuery.addEventListener("change", handleStandaloneChange);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    document.addEventListener("visibilitychange", handleStandaloneChange);

    return () => {
      cancelled = true;
      mediaQuery.removeEventListener("change", handleStandaloneChange);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      document.removeEventListener("visibilitychange", handleStandaloneChange);
    };
  }, [refreshClientState, userId]);

  const installLabel = useMemo(() => {
    if (isStandalone) {
      return "Installed";
    }
    if (installPromptEvent) {
      return "Install ready";
    }
    if (isAppleMobile) {
      return "Add to Home Screen required";
    }
    return "Browser install menu";
  }, [installPromptEvent, isAppleMobile, isStandalone]);

  const canSubscribe =
    isSupported && (!isAppleMobile || isStandalone) && permission !== "denied";

  const persistPreferences = async (
    updates: Partial<NotificationPreferences>,
    savingKey: string
  ) => {
    setSavingField(savingKey);
    setFeedback(null);

    try {
      const nextPreferences = await saveNotificationPreferences(userId, {
        ...preferences,
        ...updates,
      });
      setPreferences(nextPreferences);
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: "Failed to save notification settings.",
      });
    } finally {
      setSavingField(null);
    }
  };

  const handleMasterToggle = async () => {
    await persistPreferences(
      {
        enabled: !preferences.enabled,
      },
      "enabled"
    );
  };

  const handleFieldToggle = async (field: NotificationPreferenceField) => {
    await persistPreferences(
      {
        [field]: !preferences[field],
      },
      field
    );
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) {
      return;
    }

    setInstallBusy(true);
    setFeedback(null);

    try {
      await installPromptEvent.prompt();
      await installPromptEvent.userChoice;
      setInstallPromptEvent(null);
      await refreshClientState();
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: "The install prompt did not complete.",
      });
    } finally {
      setInstallBusy(false);
    }
  };

  const handleEnableNotifications = async () => {
    setSubscriptionBusy(true);
    setFeedback(null);

    try {
      await subscribeCurrentDevice(userId);
      await refreshClientState();
      setFeedback({
        type: "success",
        message: "Notifications are enabled on this device.",
      });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to enable notifications on this device.",
      });
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const handleDisableNotifications = async () => {
    setSubscriptionBusy(true);
    setFeedback(null);

    try {
      await unsubscribeCurrentDevice(userId);
      await refreshClientState();
      setFeedback({
        type: "success",
        message: "Notifications are disabled on this device.",
      });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: "Failed to disable notifications on this device.",
      });
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const handleSendTestPush = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setFeedback({
        type: "error",
        message: "Sign in again before sending a test notification.",
      });
      return;
    }

    setTestingPush(true);
    setFeedback(null);

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch("/api/notifications/test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; sent?: number }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to send the test notification.");
      }

      setFeedback({
        type: "success",
        message:
          payload?.sent && payload.sent > 0
            ? "Test notification sent. Check your device now."
            : "The request finished, but no subscribed device received the test notification.",
      });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to send the test notification.",
      });
    } finally {
      setTestingPush(false);
    }
  };

  return (
    <div
      className="rounded-xl border border-border bg-glass-subtle p-3 sm:p-4"
      style={{ backgroundImage: "var(--gradient-card)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Notifications</h2>
          <p className="mt-1 text-xs text-text-muted">
            Real push notifications work after install. The free version sends one daily digest instead of exact-time alerts.
          </p>
        </div>
        <div className="rounded-md bg-glass-medium px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {installLabel}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-white/[0.07] bg-glass-medium p-3 text-sm">
          <div className="text-xs font-semibold text-text-muted">App install</div>
          <div className="mt-2 text-sm text-white">
            {isStandalone
              ? "This device is already using the installed app shell."
              : isAppleMobile
                ? "On iPhone or iPad, open Share and choose Add to Home Screen first."
                : "Install the app from your browser so it feels like a normal app."}
          </div>

          {!isStandalone && installPromptEvent ? (
            <button
              type="button"
              disabled={installBusy}
              onClick={() => void handleInstallApp()}
              className="mt-3 rounded-md bg-accent px-3 py-2 text-sm font-semibold transition duration-fast hover:bg-accent-hover disabled:opacity-50"
            >
              {installBusy ? "Opening install prompt…" : "Install app"}
            </button>
          ) : null}
        </div>

        <div className="rounded-lg border border-white/[0.07] bg-glass-medium p-3 text-sm">
          <div className="text-xs font-semibold text-text-muted">Device status</div>
          <div className="mt-2 space-y-1 text-sm text-text-secondary">
            <div>
              Permission: <span className="text-white">{permission}</span>
            </div>
            <div>
              Push support: <span className="text-white">{isSupported ? "available" : "not available"}</span>
            </div>
            <div>
              This device: <span className="text-white">{hasSubscription ? "subscribed" : "not subscribed"}</span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {hasSubscription ? (
              <>
                <button
                  type="button"
                  disabled={subscriptionBusy}
                  onClick={() => void handleDisableNotifications()}
                  className="rounded-md bg-glass-subtle px-3 py-2 text-sm transition duration-fast hover:bg-glass-strong disabled:opacity-50"
                >
                  {subscriptionBusy ? "Updating…" : "Disable on this device"}
                </button>
                <button
                  type="button"
                  disabled={testingPush}
                  onClick={() => void handleSendTestPush()}
                  className="rounded-md bg-glass-subtle px-3 py-2 text-sm transition duration-fast hover:bg-glass-strong disabled:opacity-50"
                >
                  {testingPush ? "Sending test…" : "Send test push"}
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={subscriptionBusy || !canSubscribe}
                onClick={() => void handleEnableNotifications()}
                className="rounded-md bg-accent px-3 py-2 text-sm font-semibold transition duration-fast hover:bg-accent-hover disabled:opacity-50"
              >
                {subscriptionBusy ? "Enabling…" : "Enable on this device"}
              </button>
            )}
          </div>

          {permission === "denied" ? (
            <p className="mt-2 text-xs text-red-300">
              Notifications are blocked. Re-enable them from your browser or device settings.
            </p>
          ) : null}
          {!canSubscribe && isAppleMobile && !isStandalone ? (
            <p className="mt-2 text-xs text-text-muted">
              iPhone and iPad can only request permission after the app has been added to the Home Screen.
            </p>
          ) : null}
          {clientStateError ? (
            <p className="mt-2 text-xs text-red-300">{clientStateError}</p>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <div
          className={`mt-4 rounded-lg p-3 text-sm ${
            feedback.type === "error"
              ? "bg-error-muted text-red-200"
              : "bg-success-muted text-emerald-200"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="mt-4 rounded-lg border border-white/[0.07] bg-glass-medium p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">
              Daily digest reminders
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Vercel Hobby sends these once per day in an approximate window, not at an exact minute.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-white">
            <input
              type="checkbox"
              checked={preferences.enabled}
              disabled={loading || savingField === "enabled"}
              onChange={() => void handleMasterToggle()}
              className="h-4 w-4 rounded border-border bg-glass-subtle"
            />
            {savingField === "enabled" ? "Saving…" : "Enabled"}
          </label>
        </div>

        <div className="mt-4 space-y-3">
          {TOGGLE_FIELDS.map(({ field, label, description }) => (
            <label
              key={field}
              className={`flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] p-3 ${
                preferences.enabled ? "bg-glass-subtle" : "bg-glass-subtle/50 opacity-70"
              }`}
            >
              <div>
                <div className="text-sm font-medium text-white">{label}</div>
                <p className="mt-1 text-xs text-text-muted">{description}</p>
              </div>
              <input
                type="checkbox"
                checked={preferences[field]}
                disabled={loading || savingField === field}
                onChange={() => void handleFieldToggle(field)}
                className="mt-1 h-4 w-4 rounded border-border bg-glass-subtle"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}