"use client";

import { useCallback, useEffect, useState } from "react";
import { useUser } from "@/lib/auth/user-context";
import {
  dismissInAppNotice,
  loadActiveInAppNotice,
  type InAppNotice as InAppNoticeData,
} from "@/services/profile/in-app-notice";
import { Button } from "@/components/ui";

export default function InAppNotice() {
  const { user } = useUser();
  const [notice, setNotice] = useState<InAppNoticeData | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadActiveInAppNotice(user.uid)
      .then((nextNotice) => {
        if (!cancelled) {
          setNotice(nextNotice);
        }
      })
      .catch((error) => {
        console.warn("Failed to load in-app notice.", error);
      });

    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  const handleDismiss = useCallback(async () => {
    if (!notice) {
      return;
    }

    setDismissing(true);
    try {
      await dismissInAppNotice(user.uid, notice.id);
      setNotice(null);
    } catch (error) {
      console.warn("Failed to dismiss in-app notice.", error);
      setDismissing(false);
    }
  }, [notice, user.uid]);

  if (!notice) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#090615]/70 px-4 py-8 text-white backdrop-blur-md">
      <section
        aria-labelledby="in-app-notice-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-[2rem] border border-white/[0.16] bg-[linear-gradient(180deg,rgba(31,22,56,0.96),rgba(18,12,35,0.98))] p-5 shadow-[0_28px_70px_rgba(4,1,18,0.46)] sm:p-7"
        role="dialog"
      >
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-warm-accent">
          Update notice
        </div>
        <h2
          id="in-app-notice-title"
          className="mt-3 text-2xl font-medium tracking-tight text-white"
        >
          {notice.title}
        </h2>
        <p className="mt-4 whitespace-pre-line text-base leading-7 text-text-secondary">
          {notice.message}
        </p>
        <div className="mt-7 flex justify-end">
          <Button
            type="button"
            variant="warm"
            onClick={handleDismiss}
            disabled={dismissing}
          >
            {dismissing ? "Closing..." : "I saw this"}
          </Button>
        </div>
      </section>
    </div>
  );
}
