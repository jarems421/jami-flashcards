"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isAppleMobileDevice,
  isPushSupported,
  isSecureNotificationContext,
  isStandaloneApp,
  type NotificationMode,
  type NotificationPreferences,
} from "@/lib/app/notifications";
import type { Feedback as AppFeedback } from "@/lib/app/feedback";
import {
  getCurrentDevicePushSubscription,
  loadNotificationPreferences,
  saveNotificationPreferences,
  subscribeCurrentDevice,
  unsubscribeCurrentDevice,
} from "@/services/notifications";
import { auth } from "@/services/firebase/client";
import { getNotificationPermissionState } from "@/lib/app/notifications";
import { Button, Card, SectionHeader } from "@/components/ui";

type FeedbackSection = "install" | "notifications";

type Feedback = AppFeedback & {
  section: FeedbackSection;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

export default function NotificationSettingsCard({
  userId,
}: {
  userId: string;
}) {
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
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
  const [isSecureContext, setIsSecureContext] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [currentSubscriptionId, setCurrentSubscriptionId] = useState<
    string | null
  >(null);
  const [clientStateError, setClientStateError] = useState<string | null>(null);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");

  const refreshClientState = useCallback(async () => {
    const supported = isPushSupported();
    setIsSecureContext(isSecureNotificationContext());
    setIsSupported(supported);
    setIsAppleMobile(isAppleMobileDevice());
    setIsStandalone(isStandaloneApp());
    setPermission(getNotificationPermissionState());

    if (!supported) {
      setHasSubscription(false);
      setCurrentSubscriptionId(null);
      setClientStateError(null);
      return;
    }

    try {
      const subscription = await getCurrentDevicePushSubscription();
      setHasSubscription(Boolean(subscription));
      setCurrentSubscriptionId(subscription?.id ?? null);
      setClientStateError(null);
    } catch (error) {
      console.error("Failed to read this device's push subscription.", error);
      setHasSubscription(false);
      setCurrentSubscriptionId(null);
      setClientStateError(
        "This device could not finish notification setup. Reload the app and try again.",
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
        console.error("Failed to load notification preferences.", error);
        if (!cancelled) {
          setFeedback({
            type: "error",
            message: "Failed to load notification settings.",
            section: "notifications",
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
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
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
  /**
   * The state of reminders, as one quiet line rather than a coloured panel.
   *
   * This used to fill a block with `app-warning` -- a solid amber card that
   * appeared the moment reminders were switched on and then stayed, because
   * turning the preference on is only the first of two steps and the second one
   * has its own button further down this card. So the loudest element on the
   * page was a duplicate of a control already sitting below it, and the only
   * way to make it go away was to finish a task it did not offer.
   *
   * The colour lives in a two-pixel dot now. It still distinguishes the four
   * states at a glance, and none of them shouts.
   */
  const reminderStatus = useMemo(() => {
    if (!isSupported) {
      return {
        label: "Not available on this device",
        detail: "This browser does not support web push notifications.",
        dotClassName: "bg-[var(--color-text-muted)]",
      };
    }

    if (permission === "denied") {
      return {
        label: "Blocked in browser settings",
        detail:
          "Re-enable notification permission before this device can receive reminders.",
        dotClassName: "bg-[var(--color-error-text)]",
      };
    }

    if (!preferences.enabled) {
      return {
        label: "Off",
        detail: "Turn the switch on when you want Jami to nudge you.",
        dotClassName: "bg-[var(--color-text-muted)]",
      };
    }

    if (!hasSubscription) {
      return {
        label: "On, but not on this device yet",
        detail:
          "Enable notifications below and reminders will arrive here too.",
        dotClassName: "bg-[var(--color-warning-text)]",
      };
    }

    return {
      label: "On",
      detail: "Next reminder at 4:00 PM, Europe/London.",
      dotClassName: "bg-[var(--color-success-text)]",
    };
  }, [hasSubscription, isSupported, permission, preferences.enabled]);

  const persistPreferences = async (
    updates: Partial<NotificationPreferences>,
    savingKey: string,
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
      console.error("Failed to save notification preferences.", error);
      setFeedback({
        type: "error",
        message: "Failed to save notification settings.",
        section: "notifications",
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
      "enabled",
    );
  };

  const handleModeChange = async (mode: NotificationMode) => {
    if (preferences.mode === mode) {
      return;
    }

    await persistPreferences({ mode }, "mode");
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
      console.error("The browser install prompt failed.", error);
      setFeedback({
        type: "error",
        message: "The install prompt did not complete.",
        section: "install",
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
        section: "notifications",
      });
    } catch (error) {
      console.error(
        "Failed to enable push notifications on this device.",
        error,
      );
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to enable notifications on this device.",
        section: "notifications",
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
        section: "notifications",
      });
    } catch (error) {
      console.error(
        "Failed to disable push notifications on this device.",
        error,
      );
      setFeedback({
        type: "error",
        message: "Failed to disable notifications on this device.",
        section: "notifications",
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
        section: "notifications",
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
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subscriptionId: currentSubscriptionId,
        }),
      });
      // Proxy failures are not guaranteed to return JSON; status still drives
      // the stable fallback below.
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        sent?: number;
        removed?: number;
      } | null;

      if (!response.ok) {
        if (response.status === 400) {
          await unsubscribeCurrentDevice(userId).catch(() => {
            // The stale local subscription cleanup is best-effort after rejection.
          });
          await refreshClientState();
        }
        throw new Error(
          payload?.error || "Failed to send the test notification.",
        );
      }

      setFeedback({
        type: "success",
        message:
          payload?.sent && payload.sent > 0
            ? "Test notification sent to this device. Check it now."
            : "This device did not receive a test notification. Re-enable notifications here and try again.",
        section: "notifications",
      });
    } catch (error) {
      console.error("Failed to send a test push notification.", error);
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to send the test notification.",
        section: "notifications",
      });
    } finally {
      setTestingPush(false);
    }
  };

  return (
    <Card padding="lg">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <SectionHeader
          eyebrow="Reminders"
          title="Study reminders"
          description="One optional nudge at 4pm London. Jami can wait until work is ready, or remind you every day."
        />
        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
          <span className="text-sm font-medium text-text-secondary">
            {savingField === "enabled"
              ? "Saving..."
              : preferences.enabled
                ? "On"
                : "Off"}
          </span>
          <button
            type="button"
            role="switch"
            aria-label="Daily study reminder"
            aria-checked={preferences.enabled}
            disabled={loading || savingField === "enabled"}
            onClick={() => void handleMasterToggle()}
            className={`relative h-7 w-12 shrink-0 rounded-full border transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:saturate-[0.82] ${
              preferences.enabled
                ? "border-accent/40 bg-accent/65"
                : "border-[var(--color-border-strong)] bg-[var(--color-glass-medium)]"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-[var(--color-text-inverse)] shadow-sm transition duration-fast ${
                preferences.enabled ? "left-6" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      <div
        className="app-subtle-panel mt-5 flex items-start gap-3 rounded-xl px-4 py-3"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className={`mt-[0.45rem] h-2 w-2 shrink-0 rounded-full ${reminderStatus.dotClassName}`}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">
            {reminderStatus.label}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-text-muted">
            {reminderStatus.detail}
          </p>
        </div>
      </div>

      {preferences.enabled ? (
        <div className="mt-5">
          <div className="text-sm font-semibold text-text-primary">
            When should Jami remind you?
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              {
                value: "smart" as NotificationMode,
                label: "Only when work is waiting",
                description:
                  "A quieter reminder that follows your study queue.",
              },
              {
                value: "always" as NotificationMode,
                label: "Every study day",
                description: "A daily nudge, even when your queue is clear.",
              },
            ].map((option) => {
              const selected = preferences.mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={loading || savingField === "mode"}
                  onClick={() => void handleModeChange(option.value)}
                  className={`rounded-xl px-4 py-3.5 text-left transition duration-fast ${
                    selected
                      ? "app-selected"
                      : "app-chip hover:border-border-strong hover:bg-[var(--color-glass-medium)]"
                  } disabled:cursor-not-allowed disabled:saturate-[0.82]`}
                >
                  <span className="block text-sm font-semibold">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-inherit/80">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
          {savingField === "mode" ? (
            <p className="mt-3 text-xs text-text-muted">
              Saving reminder mode...
            </p>
          ) : null}
        </div>
      ) : null}

      {feedback?.section === "notifications" ? (
        <div
          className={`mt-4 rounded-xl border p-3 text-sm ${
            feedback.type === "error" ? "app-danger" : "app-success"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <details className="group app-subtle-panel mt-5 overflow-hidden rounded-xl">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left transition duration-fast hover:bg-[var(--color-glass-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/45 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text-primary">
              Device &amp; app setup
            </span>
            <span className="mt-0.5 block text-xs text-text-muted">
              Permission, installation, and test controls
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="app-chip hidden rounded-full px-2.5 py-1 text-2xs font-semibold sm:inline-flex">
              {hasSubscription ? "This device on" : installLabel}
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className="h-4 w-4 text-text-muted transition-transform duration-fast group-open:rotate-180"
            >
              <path
                d="m5 7.5 5 5 5-5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </summary>

        <div className="grid gap-6 border-t border-[var(--color-border)] p-4 sm:p-5 lg:grid-cols-2">
          <section>
            <h3 className="text-sm font-semibold text-text-primary">
              This device
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {[
                ["Permission", permission],
                ["Push support", isSupported ? "Available" : "Unavailable"],
                ["Secure page", isSecureContext ? "Yes" : "No"],
                ["Subscription", hasSubscription ? "Enabled" : "Not enabled"],
              ].map(([label, value]) => (
                <div key={label} className="app-chip rounded-lg px-3 py-2.5">
                  <dt className="text-2xs uppercase tracking-[0.16em] text-text-muted">
                    {label}
                  </dt>
                  <dd className="mt-1 font-semibold text-text-primary">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              {hasSubscription ? (
                <>
                  <Button
                    type="button"
                    disabled={subscriptionBusy}
                    onClick={() => void handleDisableNotifications()}
                    variant="secondary"
                    size="sm"
                  >
                    {subscriptionBusy ? "Updating..." : "Disable here"}
                  </Button>
                  <Button
                    type="button"
                    disabled={testingPush}
                    onClick={() => void handleSendTestPush()}
                    variant="secondary"
                    size="sm"
                  >
                    {testingPush ? "Sending..." : "Send test"}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  disabled={subscriptionBusy || !canSubscribe}
                  onClick={() => void handleEnableNotifications()}
                  size="sm"
                >
                  {subscriptionBusy ? "Enabling..." : "Enable on this device"}
                </Button>
              )}
            </div>

            {permission === "denied" ? (
              <p className="mt-3 text-xs text-[var(--color-error-text)]">
                Notifications are blocked. Re-enable them from your browser or
                device settings.
              </p>
            ) : null}
            {!canSubscribe && isAppleMobile && !isStandalone ? (
              <p className="mt-3 text-xs leading-5 text-text-muted">
                iPhone and iPad can request permission only from the installed
                Home Screen app.
              </p>
            ) : null}
            {!isSecureContext ? (
              <p className="mt-3 text-xs text-[var(--color-error-text)]">
                Push needs HTTPS, or localhost during development.
              </p>
            ) : null}
            {clientStateError ? (
              <p className="mt-3 text-xs text-[var(--color-error-text)]">
                {clientStateError}
              </p>
            ) : null}
          </section>

          <section>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  Install Jami
                </h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Optional, for a more native mobile feel.
                </p>
              </div>
              <span className="app-chip rounded-full px-2.5 py-1 text-2xs font-semibold">
                {installLabel}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              {isStandalone
                ? "Jami is installed on this device."
                : isAppleMobile
                  ? "Open Jami in Safari, tap Share, then Add to Home Screen. Reopen it from that icon before enabling notifications."
                  : "Install Jami from your browser's app or install menu."}
            </p>

            {!isStandalone && !installPromptEvent && !isAppleMobile ? (
              <p className="mt-2 text-xs leading-5 text-text-muted">
                If no install prompt appears here, use the browser menu.
              </p>
            ) : null}
            {!isStandalone && installPromptEvent ? (
              <Button
                type="button"
                disabled={installBusy}
                onClick={() => void handleInstallApp()}
                className="mt-4"
                size="sm"
              >
                {installBusy ? "Opening install prompt..." : "Install app"}
              </Button>
            ) : null}
            {feedback?.section === "install" ? (
              <div
                className={`mt-4 rounded-xl border p-3 text-sm ${
                  feedback.type === "error" ? "app-danger" : "app-success"
                }`}
              >
                {feedback.message}
              </div>
            ) : null}
          </section>
        </div>
      </details>
    </Card>
  );
}
