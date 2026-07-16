"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui";

type WorkspaceActionDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  busy?: boolean;
  maxWidth?: "md" | "lg" | "xl";
  onClose: () => void;
};

const maxWidthClasses: Record<
  NonNullable<WorkspaceActionDialogProps["maxWidth"]>,
  string
> = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-5xl",
};

export default function WorkspaceActionDialog({
  open,
  title,
  description,
  children,
  busy = false,
  maxWidth = "md",
  onClose,
}: WorkspaceActionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame = window.requestAnimationFrame(() => {
      const autofocusTarget = panelRef.current?.querySelector<HTMLElement>(
        '[data-dialog-autofocus="true"]'
      );
      (autofocusTarget ?? closeButtonRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        onCloseRef.current();
        return;
      }

      if (event.key === "Tab") {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center p-0 sm:items-center sm:p-5">
      <button
        type="button"
        aria-label={`Close ${title}`}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        disabled={busy}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`app-panel relative flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-b-none rounded-t-[1.7rem] shadow-[0_28px_80px_rgba(0,0,0,0.5)] sm:max-h-[calc(100dvh-2.5rem)] sm:rounded-[1.9rem] ${maxWidthClasses[maxWidth]}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-lg font-semibold tracking-tight text-text-primary sm:text-xl"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-1 max-w-2xl text-sm leading-6 text-text-muted"
              >
                {description}
              </p>
            ) : null}
          </div>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Close ${title}`}
            disabled={busy}
            onClick={onClose}
            className="shrink-0"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
              className="h-5 w-5"
            >
              <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
          {children}
        </div>
      </div>
    </div>
  );
}
