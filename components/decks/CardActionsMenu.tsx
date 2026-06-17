"use client";

type CardActionsMenuProps = {
  deleting?: boolean;
  disabled?: boolean;
  onPreview: () => void;
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
  onPreview,
  onEdit,
  onDelete,
}: CardActionsMenuProps) {
  return (
    <details className="group relative">
      <summary
        aria-label="Card actions"
        className="app-chip flex h-10 w-10 list-none items-center justify-center rounded-full transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
          <circle cx="4" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="16" cy="10" r="1.6" />
        </svg>
      </summary>
      <div className="absolute right-0 top-12 z-30 min-w-44 overflow-hidden rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1.5 shadow-[0_18px_46px_rgba(0,0,0,0.28)]">
        <button
          type="button"
          onClick={(event) => {
            closeMenu(event.currentTarget);
            onPreview();
          }}
          className="flex w-full items-center rounded-[0.75rem] px-3 py-2 text-left text-sm font-medium text-text-primary transition hover:bg-[var(--color-glass-subtle)]"
        >
          Preview
        </button>
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
