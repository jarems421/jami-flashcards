"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  OCCLUSION_COVER_COLOR_LABELS,
  OCCLUSION_COVER_COLORS,
  occlusionCoverClass,
  type OcclusionCoverColor,
} from "@/lib/study/image-occlusion";

const OPTIONS: { color: OcclusionCoverColor | null; label: string }[] = [
  { color: null, label: "Theme" },
  ...OCCLUSION_COVER_COLORS.map((color) => ({ color, label: OCCLUSION_COVER_COLOR_LABELS[color] })),
];

/**
 * The diagram toolbar's colour button: a dot in the covers' current colour,
 * opening the theme's accent and the named colours beside it. One button
 * rather than six dots, so the toolbar still fits a phone on two rows.
 */
export default function DiagramCoverColorMenu({
  value,
  onChange,
  disabled,
}: {
  value: OcclusionCoverColor | null;
  onChange: (color: OcclusionCoverColor | null) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = OPTIONS.find((option) => option.color === value) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Cover colour: ${current.label}`}
        title="Cover colour"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen((isOpen) => !isOpen)}
        className="inline-flex h-11 min-w-11 items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] transition duration-200 hover:-translate-y-0.5 hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-selected-border)] active:translate-y-0 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={`occlusion-cover-swatch h-5 w-5 rounded-full ring-2 ring-white/80 ${occlusionCoverClass(current.color)}`}
        />
      </button>
      {open ? (
        <div
          id={listId}
          role="radiogroup"
          aria-label="Cover colour"
          className="absolute left-0 top-full z-30 mt-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-2 shadow-card"
        >
          <p className="px-1 pb-1.5 text-xs font-semibold text-text-secondary">Cover colour</p>
          <div className="flex items-center gap-1">
            {OPTIONS.map((option) => {
              const active = option.color === value;
              return (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => {
                    onChange(option.color);
                    setOpen(false);
                    triggerRef.current?.focus({ preventScroll: true });
                  }}
                  className={`grid h-9 w-9 place-items-center rounded-full border-2 transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-selected-border)] ${
                    active ? "border-text-primary" : "border-transparent hover:border-[var(--color-border-strong)]"
                  }`}
                >
                  <span aria-hidden="true" className={`occlusion-cover-swatch h-6 w-6 rounded-full ${occlusionCoverClass(option.color)}`} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
