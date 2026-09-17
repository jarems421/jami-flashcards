"use client";

import { useMemo, useState } from "react";
import { Card, FormDisclosure, SectionHeader } from "@/components/ui";
import { useUser } from "@/components/providers/UserProvider";
import { useAppFont } from "@/hooks/useAppFont";
import {
  APP_FONT_GROUPS,
  APP_FONT_OPTIONS,
  getAppFontOption,
  type AppFontFamilyKind,
  type AppFontId,
} from "@/lib/app/app-font";
import { updateAppearance } from "@/services/profile/appearance";

/**
 * The typeface Jami is set in, chosen from a specimen list.
 *
 * A face cannot be picked from its name -- nobody knows what Gilda Display
 * looks like until they see it -- so every row is set in the face it offers.
 * But twenty-five specimens is a page of its own, and this card sits among
 * four other appearance settings, so the list folds away behind the one line
 * that matters: what Jami is set in now. Opening it is the moment a student is
 * actually browsing; until then the setting costs one row.
 *
 * Choosing repaints the whole app behind the card, which is the preview.
 */

type Shelf = AppFontFamilyKind | "all";

const SHELVES: Array<{ value: Shelf; label: string }> = [
  { value: "all", label: "All" },
  ...APP_FONT_GROUPS.map((group) => ({ value: group.kind as Shelf, label: group.title })),
];

/** The face's own variable, so a row is set in what it is offering. */
function fontStack(id: AppFontId) {
  return `var(--font-${id}), var(--font-urbanist), ui-sans-serif, sans-serif`;
}

export default function AppFontCard() {
  const { user } = useUser();
  const [font, setFontOnDevice] = useAppFont();
  const [shelf, setShelf] = useState<Shelf>("all");

  const selected = getAppFontOption(font);
  const shown = useMemo(
    () => (shelf === "all" ? APP_FONT_OPTIONS : APP_FONT_OPTIONS.filter((o) => o.kind === shelf)),
    [shelf],
  );

  const chooseFont = (id: AppFontId) => {
    setFontOnDevice(id);
    void updateAppearance(user.uid, { font: id }).catch((error: unknown) => {
      console.warn("Could not save the font to your account.", error);
    });
  };

  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Appearance"
        title="Jami's lettering"
        description="Every word in the app is set in the face you pick, on every device you sign into."
      />

      <FormDisclosure
        className="mt-4"
        title="Typeface"
        summary={
          <span style={{ fontFamily: fontStack(selected.id) }}>{selected.label}</span>
        }
      >
        <div
          role="tablist"
          aria-label="Lettering shelves"
          className="flex gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-0.5"
        >
          {SHELVES.map((option) => {
            const active = option.value === shelf;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setShelf(option.value)}
                className={`min-h-[2rem] flex-1 rounded-full px-2 text-xs font-semibold transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
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

        {/*
          Scrolls rather than growing: the whole point of folding the list away
          is that opening it should not push the rest of Account off screen.
        */}
        <div
          role="radiogroup"
          aria-label="App lettering"
          className="mt-3 grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-3 xl:grid-cols-4"
        >
          {shown.map((option) => {
            const active = option.id === font;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                title={option.description}
                aria-label={`${option.label}. ${option.description}`}
                onClick={() => chooseFont(option.id)}
                className={`flex min-h-[2.5rem] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                  active
                    ? "border-[var(--color-accent)] bg-[var(--color-surface-panel-strong)] shadow-ring"
                    : "border-transparent bg-[var(--color-glass-subtle)] hover:bg-[var(--color-glass-medium)]"
                }`}
              >
                <span
                  className="min-w-0 flex-1 truncate text-sm leading-5 text-text-primary"
                  style={{ fontFamily: fontStack(option.id) }}
                >
                  {option.label}
                </span>
                {active ? (
                  <span
                    aria-hidden="true"
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-accent-on"
                  >
                    <svg viewBox="0 0 20 20" fill="none" className="h-2.5 w-2.5">
                      <path
                        d="m5 10.5 3.4 3.4L15 7.2"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </FormDisclosure>
    </Card>
  );
}
