"use client";

import { useId } from "react";
import { usePanelStyle } from "@/hooks/usePanelStyle";
import type { PanelStyle } from "@/lib/app/panel-style";

const PANEL_STYLE_OPTIONS: Array<{ value: PanelStyle; label: string; detail: string }> = [
  { value: "glass", label: "See-through", detail: "Your background shows through cards and menus" },
  { value: "solid", label: "Solid", detail: "Cards and menus sit fully opaque over it" },
];

/**
 * Whether panels let a photo or star-sky background show through.
 *
 * One line with a small switch rather than a pair of option tiles: it sits
 * under the background controls in Account and on Stars, where a setting this
 * small should not take up half the card.
 */
export default function PanelStyleSetting({ className = "" }: { className?: string }) {
  const [panelStyle, setPanelStyle] = usePanelStyle();
  const labelId = useId();
  const selected = PANEL_STYLE_OPTIONS.find((option) => option.value === panelStyle);

  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium text-text-primary">
          Panels
        </p>
        <p className="mt-0.5 text-xs text-text-muted">{selected?.detail}</p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="flex shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-0.5"
      >
        {PANEL_STYLE_OPTIONS.map((option) => {
          const active = option.value === panelStyle;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPanelStyle(option.value)}
              className={`min-h-[2rem] rounded-full px-3 text-xs font-semibold transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                active
                  ? "bg-[var(--color-surface-panel-strong)] text-text-primary shadow-e1"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
