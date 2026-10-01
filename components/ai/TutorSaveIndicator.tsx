import type { TutorSaveStatus } from "@/hooks/useTutorPersonalisation";

const STATUS_COPY: Record<TutorSaveStatus, string> = {
  idle: "Changes save as you make them.",
  saving: "Saving…",
  saved: "Saved. Applies to your next question.",
  failed: "That change was not saved.",
};

/** One line of quiet status for settings that save themselves. */
export function TutorSaveIndicator({ status }: { status: TutorSaveStatus }) {
  return (
    <p
      role="status"
      className={`flex items-center gap-1.5 text-2xs ${
        status === "failed" ? "text-[var(--color-error-text)]" : "text-text-muted"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          status === "saving"
            ? "animate-pulse bg-accent"
            : status === "saved"
              ? "bg-accent"
              : status === "failed"
                ? "bg-[var(--color-error)]"
                : "bg-[var(--color-border-strong)]"
        }`}
      />
      {STATUS_COPY[status]}
    </p>
  );
}
