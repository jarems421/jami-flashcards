"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    if (autoDismissMs <= 0) return;

    const dismissTimer = window.setTimeout(onDismiss, autoDismissMs);
    return () => {
      window.clearTimeout(dismissTimer);
    };
  }, [autoDismissMs, message, onDismiss, type]);

  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-4 rounded-[1.7rem] border px-4 py-3 text-sm ${
        type === "error"
          ? "border-error/35 bg-error-muted text-[var(--color-error-text)]"
          : "border-success/35 bg-success-muted text-[var(--color-success-text)]"
      }`}
    >
      <div>{message}</div>
      <button
        type="button"
        onClick={onDismiss}
        className="app-chip rounded-full px-3 py-1.5 text-xs font-medium transition duration-fast hover:border-border-strong"
      >
        Dismiss
      </button>
    </div>
  );
}
