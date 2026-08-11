"use client";

import { Button, OptionSwitch } from "@/components/ui";
import type { Source } from "@/lib/material/sources";
import { MAX_PRACTICE_PAPER_SOURCE_IDS } from "@/lib/practice/practice-papers";

const MODE_OPTIONS = [
  {
    value: "automatic" as const,
    label: "Let Jami choose",
    detail: "Picks the specs, briefs and mark schemes that fit this folder.",
  },
  {
    value: "manual" as const,
    label: "Choose sources",
    detail: `Pick up to ${MAX_PRACTICE_PAPER_SOURCE_IDS} yourself.`,
  },
];

export default function PracticePaperSourcePicker({
  sources,
  proposedSources,
  automaticConfirmed,
  selectedIds,
  automatic,
  disabled,
  onAutomaticChange,
  onConfirmAutomatic,
  onChange,
}: {
  sources: Source[];
  proposedSources: Source[];
  automaticConfirmed: boolean;
  selectedIds: string[];
  automatic: boolean;
  disabled?: boolean;
  onAutomaticChange: (automatic: boolean) => void;
  onConfirmAutomatic: () => void;
  onChange: (sourceIds: string[]) => void;
}) {
  const toggle = (sourceId: string) => {
    const selected = selectedIds.includes(sourceId);
    if (selected) {
      onChange(selectedIds.filter((id) => id !== sourceId));
      return;
    }
    if (selectedIds.length >= MAX_PRACTICE_PAPER_SOURCE_IDS) return;
    onChange([...selectedIds, sourceId]);
  };

  return (
    <details className="group overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)]">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block">Material Jami will use</span>
          <span className="mt-0.5 block text-xs font-medium text-text-muted">
            {automatic
              ? automaticConfirmed
                ? `Chosen automatically · ${proposedSources.length} confirmed`
                : "Chosen automatically · not confirmed yet"
              : `${selectedIds.length} of ${MAX_PRACTICE_PAPER_SOURCE_IDS} selected`}
          </span>
        </span>
        {/*
          * A drawn chevron rather than the "⌄" character this used to set. That
          * glyph renders at a different weight and baseline in every font on
          * every platform, and cannot be rotated onto its own centre, so the
          * open state drifted. It is also the only thing telling anyone the
          * panel opens at all.
          */}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-fast group-open:rotate-180"
        >
          <path
            d="m4 6 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>

      <div className="space-y-5 border-t border-[var(--color-border)] p-4">
        <OptionSwitch
          label="How sources get chosen"
          value={automatic ? "automatic" : "manual"}
          options={MODE_OPTIONS}
          disabled={disabled}
          onChange={(value) => onAutomaticChange(value === "automatic")}
        />

        {automatic ? (
          <div>
            <p className="text-sm leading-6 text-text-secondary">
              Jami proposes up to {MAX_PRACTICE_PAPER_SOURCE_IDS} relevant
              sources, prioritising current specifications, assessment briefs,
              rubrics, mark schemes and recent past papers.
            </p>
            {proposedSources.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {proposedSources.map((source) => (
                  <li
                    key={source.id}
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-3 py-1.5 text-xs text-text-secondary"
                  >
                    {source.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs leading-5 text-text-muted">
                No folder sources are available. Jami will use the folder level
                and general knowledge.
              </p>
            )}
            <Button
              type="button"
              size="sm"
              className="mt-4"
              variant={automaticConfirmed ? "secondary" : "primary"}
              disabled={disabled || automaticConfirmed}
              onClick={onConfirmAutomatic}
            >
              {automaticConfirmed
                ? "Sources confirmed"
                : proposedSources.length > 0
                  ? `Use these ${proposedSources.length} sources`
                  : "Continue without sources"}
            </Button>
          </div>
        ) : sources.length > 0 ? (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs text-text-muted">
                Tap a source to include it.
              </p>
              {selectedIds.length >= MAX_PRACTICE_PAPER_SOURCE_IDS ? (
                <p className="text-xs font-medium text-[var(--color-warning-text)]">
                  Limit reached — remove one to swap it out.
                </p>
              ) : null}
            </div>
            {/*
              * The whole row is the control. It carried `cursor-pointer` and a
              * hover-weight border while only the checkbox and the title text
              * actually did anything, so most of a 14mm-tall target quietly did
              * nothing when tapped. A label wrapping the input makes the
              * pointer's promise true and gives touch the full row.
              */}
            <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
              {sources.map((source) => {
                const checked = selectedIds.includes(source.id);
                const atLimit =
                  !checked && selectedIds.length >= MAX_PRACTICE_PAPER_SOURCE_IDS;
                const blocked = disabled || atLimit;
                return (
                  <li key={source.id}>
                    <label
                      className={`flex min-h-14 items-start gap-3 rounded-xl border p-3 transition duration-fast focus-within:ring-2 focus-within:ring-accent/45 ${
                        checked
                          ? "border-accent/55 bg-accent/10"
                          : "border-[var(--color-border)] bg-[var(--color-surface-panel)]"
                      } ${
                        blocked
                          ? "cursor-not-allowed opacity-55"
                          : "cursor-pointer hover:border-[var(--color-border-strong)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blocked}
                        onChange={() => toggle(source.id)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-sm border transition duration-fast ${
                          checked
                            ? "border-accent bg-accent text-white"
                            : "border-[var(--color-border-strong)]"
                        }`}
                      >
                        {checked ? (
                          <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3">
                            <path
                              d="m2.5 6.2 2.4 2.4 4.6-5"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text-primary">
                          {source.title}
                        </span>
                        <span className="mt-0.5 block text-xs capitalize text-text-muted">
                          {source.type.replace("_", " ")}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="text-sm leading-6 text-text-muted">
            This folder has no sources yet. Jami can still create a general
            practice paper, but it may not match a particular specification or
            lecturer.
          </p>
        )}
      </div>
    </details>
  );
}
