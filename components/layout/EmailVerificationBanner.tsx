"use client";

import { useCallback, useEffect, useState } from "react";
import { refreshCurrentUser, resendEmailVerification } from "@/services/auth";
import { listenToAuth } from "@/services/auth/auth-listener";
import { Button } from "@/components/ui";

/**
 * Asks people who have not confirmed their email to do it.
 *
 * Verification was being sent and then never mentioned again, which made it a
 * mail nobody was prompted to act on -- and left every account created before
 * it existed unverified with no way to fix that. This is the way: it shows for
 * exactly the accounts that need it, and offers the mail to accounts that never
 * received one.
 *
 * It never blocks anything. A confirmed address matters because it is the only
 * way back in after a forgotten password, but that is a reason to ask, not a
 * reason to hold somebody's notebooks hostage until they check their inbox.
 *
 * Google accounts arrive verified, so they never see this.
 */

const DISMISSED_KEY = "jami:verify-email-dismissed";

export default function EmailVerificationBanner() {
  const [needsVerifying, setNeedsVerifying] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState<"sending" | "checking" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(
        window.sessionStorage.getItem(DISMISSED_KEY) === "true"
      );
    } catch {
      // Storage can be unavailable in privacy modes; asking again is the safe
      // side of this particular default.
      setDismissed(false);
    }
  }, []);

  useEffect(
    () =>
      listenToAuth((user) => {
        // No user means the gate above is already handling it.
        setNeedsVerifying(Boolean(user && user.email && !user.emailVerified));
      }),
    []
  );

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Dismissing for this view is enough.
    }
  }, []);

  const resend = useCallback(async () => {
    setBusy("sending");
    setNotice(null);
    try {
      await resendEmailVerification();
      setNotice("Sent. Follow the link in your inbox, then choose I've confirmed it.");
    } catch {
      setNotice("That could not be sent just now. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }, []);

  const recheck = useCallback(async () => {
    setBusy("checking");
    setNotice(null);
    try {
      const user = await refreshCurrentUser();
      if (user?.emailVerified) {
        setNeedsVerifying(false);
        return;
      }
      setNotice("Not confirmed yet. Follow the link in the email first.");
    } catch {
      setNotice("That could not be checked just now. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }, []);

  if (!needsVerifying || dismissed) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/30 bg-warning-muted px-4 py-2.5 text-xs text-text-secondary"
    >
      <p className="min-w-0 flex-1 leading-5">
        {notice ?? "Confirm your email address so you can get back in if you forget your password."}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => void resend()}
        >
          {busy === "sending" ? "Sending..." : "Send email"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => void recheck()}
        >
          {busy === "checking" ? "Checking..." : "I've confirmed it"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
