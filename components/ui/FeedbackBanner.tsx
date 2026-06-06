"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type FeedbackBannerProps = {
  type: "success" | "error";
  message: string;
  onDismiss: () => void;
  autoDismissMs?: number;
};

export default function FeedbackBanner({
  type,
  message,
  onDismiss,
  autoDismissMs = 3000,
}: FeedbackBannerProps) {
  const [leaving, setLeaving] = useState(false);
  const onDismissRef = useRef(onDismiss);
  const dismissTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const beginDismiss = useCallback(() => {
    if (dismissTimeoutRef.current !== null) return;
    setLeaving(true);
    dismissTimeoutRef.current = window.setTimeout(() => {
      dismissTimeoutRef.current = null;
      onDismissRef.current();
    }, 180);
  }, []);

  useEffect(() => {
    if (autoDismissMs <= 0) return;

    const dismissTimer = window.setTimeout(beginDismiss, autoDismissMs);
    return () => {
      window.clearTimeout(dismissTimer);
      if (dismissTimeoutRef.current !== null) {
        window.clearTimeout(dismissTimeoutRef.current);
        dismissTimeoutRef.current = null;
      }
    };
  }, [autoDismissMs, beginDismiss, message, type]);

  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-4 rounded-[1.7rem] border px-4 py-3 text-sm transition duration-200 ${
        leaving ? "-translate-y-1 opacity-0" : "translate-y-0 opacity-100"
      } ${
        type === "error"
          ? "border-error/35 bg-error-muted text-[var(--color-error-text)]"
          : "border-success/35 bg-success-muted text-[var(--color-success-text)]"
      }`}
    >
      <div>{message}</div>
      <button
        type="button"
        onClick={beginDismiss}
        className="app-chip rounded-full px-3 py-1.5 text-xs font-medium transition duration-fast hover:border-border-strong"
      >
        Dismiss
      </button>
    </div>
  );
}
