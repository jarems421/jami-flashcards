"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

export type OptionMenuOption<Value extends string> = {
  value: Value;
  label: string;
  /** One line on what choosing this actually does. */
  detail?: string;
  /** A short word beside the label, for the one option worth pointing at. */
  badge?: string;
};

/**
 * Picks one of several ways of doing the same thing, from behind a bubble.
 *
 * The sibling of `OptionSwitch`, for the same job at a different size. A switch
 * lays every option on the surface, which is right for two or three and wrong
 * for five: five tiles is a settings panel sitting on top of a screen whose
 * only real button is Start. This shows the current choice as one pill and
 * keeps the rest, with their explanations, one click away.
 *
 * The list opens in the flow rather than floating over the page. Every card in
 * this app is `overflow-hidden` with a backdrop filter, and a backdrop filter
 * makes a containing block that clips even `position: fixed` -- so an overlay
 * would need a portal and a measured rectangle to escape a card it is already
 * sitting comfortably inside. Pushing the content below it down for as long as
 * the list is open costs nothing and never clips.
 */
export default function OptionMenu<Value extends string>({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
}: {
  label: string;
  /** Keep the label for screen readers where a heading already asks it. */
  hideLabel?: boolean;
  value: Value;
  options: readonly OptionMenuOption<Value>[];
  onChange: (value: Value) => void;
  disabled?: boolean;
  className?: string;
}) {
  const labelId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const selected = options[selectedIndex];

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Opening moves focus onto the current choice, so the keyboard lands where
  // the eye does and the arrows carry on from there. Deliberately keyed on
  // `open` alone: re-running as the selection changes would take the focus back
  // off whichever option the arrow keys had just moved to.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    optionRefs.current[selectedIndex]?.focus({ preventScroll: true });
  }, [open, selectedIndex]);

  const moveFocus = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    optionRefs.current[next]?.focus({ preventScroll: true });
  };

  return (
    <div ref={containerRef} className={className}>
      <span
        id={labelId}
        className={
          hideLabel
            ? "sr-only"
            : "mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
        }
      >
        {label}
      </span>

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${listId}-trigger`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="app-chip flex min-h-12 w-full max-w-md items-center justify-between gap-3 rounded-full px-4 py-2 text-left transition duration-fast hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span id={`${listId}-trigger`} className="min-w-0 truncate">
          <span className="text-sm font-semibold text-text-primary">
            {selected?.label}
          </span>
          {selected?.detail ? (
            <span className="ml-2 hidden text-xs text-text-muted sm:inline">
              {selected.detail}
            </span>
          ) : null}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className={`h-4 w-4 shrink-0 text-text-muted transition duration-fast ${open ? "rotate-180" : ""}`}
        >
          <path
            d="m4 6.5 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-labelledby={labelId}
          // Focus lives on the options, which are buttons. The list itself is
          // only programmatically focusable, which is what a roving-focus
          // listbox wants and what keeps it out of the tab order.
          tabIndex={-1}
          // Capped and scrollable so a phone never has to scroll the page past
          // an open list to reach the button underneath it.
          className="mt-2 max-h-[min(60vh,24rem)] w-full max-w-md animate-fade-in space-y-1 overflow-y-auto overscroll-contain rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1.5 shadow-e3"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close(true);
            }
          }}
        >
          {options.map((option, optionIndex) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[optionIndex] = node;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  close(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveFocus(optionIndex, 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveFocus(optionIndex, -1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    optionRefs.current[0]?.focus({ preventScroll: true });
                  } else if (event.key === "End") {
                    event.preventDefault();
                    optionRefs.current[options.length - 1]?.focus({
                      preventScroll: true,
                    });
                  } else if (event.key === "Tab") {
                    setOpen(false);
                  }
                }}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                  isSelected
                    ? "bg-accent/10"
                    : "hover:bg-[var(--color-glass-subtle)]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition duration-fast ${
                    isSelected
                      ? "border-accent bg-accent"
                      : "border-[var(--color-border-strong)]"
                  }`}
                >
                  {isSelected ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">
                      {option.label}
                    </span>
                    {option.badge ? (
                      <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-2xs font-semibold uppercase tracking-[0.12em] text-text-secondary">
                        {option.badge}
                      </span>
                    ) : null}
                  </span>
                  {option.detail ? (
                    <span className="mt-0.5 block text-xs leading-5 text-text-muted">
                      {option.detail}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
