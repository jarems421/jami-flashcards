"use client";

import { useAdaptiveMenuPlacement } from "@/components/ui/useAdaptiveMenuPlacement";

type CardActionsMenuProps = {
  deleting?: boolean;
  disabled?: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

function closeMenu(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return;
  target.closest("details")?.removeAttribute("open");
}

export default function CardActionsMenu({
  deleting = false,
  disabled = false,
  onEdit,
  onDelete,
}: CardActionsMenuProps) {
  const { handleToggle, menuPositionClass } =
    useAdaptiveMenuPlacement(96);

  return (
    <details className="group relative flex h-10 w-10 items-center justify-center" onToggle={handleToggle}>
      <summary
        aria-label="Card actions"
        className="flex h-[1.875rem] w-[1.875rem] list-none items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-muted transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <circle cx="4" cy="10" r="1.35" />
          <circle cx="10" cy="10" r="1.35" />
          <circle cx="16" cy="10" r="1.35" />
        </svg>
      </summary>
      <div className={`absolute right-0 z-30 min-w-44 overflow-hidden rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1.5 shadow-[0_18px_46px_rgba(0,0,0,0.28)] ${menuPositionClass}`}>
        <button
          type="button"
          disabled={disabled}
          onClick={(event) => {
            closeMenu(event.currentTarget);
            onEdit();
          }}
          className="flex w-full items-center rounded-[0.75rem] px-3 py-2 text-left text-sm font-medium text-text-primary transition hover:bg-[var(--color-glass-subtle)] disabled:cursor-not-allowed disabled:text-[var(--button-disabled-text)]"
        >
          Edit card
        </button>
        <button
          type="button"
          disabled={disabled || deleting}
          onClick={(event) => {
            closeMenu(event.currentTarget);
            onDelete();
          }}
          className="flex w-full items-center rounded-[0.75rem] px-3 py-2 text-left text-sm font-semibold text-error transition hover:bg-[var(--color-error-muted)] disabled:cursor-not-allowed disabled:text-[var(--button-disabled-text)]"
        >
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </details>
  );
}
