"use client";

type FeedbackBannerProps = {
  type: "success" | "error";
  message: string;
  onDismiss: () => void;
};

export default function FeedbackBanner({
  type,
  message,
  onDismiss,
}: FeedbackBannerProps) {
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-4 rounded-[1.7rem] border px-4 py-3 text-sm ${
        type === "error"
          ? "border-error-muted bg-error-muted text-rose-100"
          : "border-success-muted bg-success-muted text-emerald-100"
      }`}
    >
      <div>{message}</div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90 transition duration-fast hover:bg-white/15"
      >
        Dismiss
      </button>
    </div>
  );
}
