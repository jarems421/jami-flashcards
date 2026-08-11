"use client";

import { Button } from "@/components/ui";
import type { Source } from "@/lib/material/sources";
import { MAX_PRACTICE_PAPER_SOURCE_IDS } from "@/lib/practice/practice-papers";

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
    <details className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)]">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 text-sm font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
        <span>
          Material Jami will use
          <span className="ml-2 text-xs font-medium text-text-muted">
            {automatic ? "Chosen automatically" : `${selectedIds.length}/15 selected`}
          </span>
        </span>
        <span aria-hidden="true" className="text-text-muted transition group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="space-y-4 border-t border-[var(--color-border)] p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Source selection method">
          <Button
            type="button"
            size="sm"
            variant={automatic ? "primary" : "secondary"}
            aria-pressed={automatic}
            disabled={disabled}
            onClick={() => onAutomaticChange(true)}
          >
            Let Jami choose
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!automatic ? "primary" : "secondary"}
            aria-pressed={!automatic}
            disabled={disabled}
            onClick={() => onAutomaticChange(false)}
          >
            Choose sources
          </Button>
        </div>

        {automatic ? (
          <div>
            <p className="text-sm leading-6 text-text-secondary">
              Jami proposes up to 15 relevant sources, prioritising current specifications,
              assessment briefs, rubrics, mark schemes and recent past papers.
            </p>
            {proposedSources.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {proposedSources.map((source) => (
                  <span key={source.id} className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-3 py-1.5 text-xs text-text-secondary">
                    {source.title}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-text-muted">
                No folder sources are available. Jami will use the folder level and general knowledge.
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
          <div className="grid gap-2 sm:grid-cols-2">
            {sources.map((source) => {
              const checked = selectedIds.includes(source.id);
              const atLimit = !checked && selectedIds.length >= MAX_PRACTICE_PAPER_SOURCE_IDS;
              return (
                <div
                  key={source.id}
                  className={`flex min-h-14 items-start gap-3 rounded-lg border p-3 transition ${
                    checked
                      ? "border-accent/45 bg-accent/10"
                      : "border-[var(--color-border)] bg-[var(--color-surface-panel)]"
                  } ${atLimit ? "opacity-55" : "cursor-pointer"}`}
                >
                  <input
                    id={`practice-paper-source-${source.id}`}
                    type="checkbox"
                    checked={checked}
                    disabled={disabled || atLimit}
                    onChange={() => toggle(source.id)}
                    className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <label
                      htmlFor={`practice-paper-source-${source.id}`}
                      className="block cursor-pointer truncate text-sm font-semibold text-text-primary"
                    >
                      {source.title}
                    </label>
                    <span className="mt-0.5 block text-xs capitalize text-text-muted">
                      {source.type.replace("_", " ")}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            This folder has no sources yet. Jami can still create a general practice paper,
            but it may not match a particular specification or lecturer.
          </p>
        )}
      </div>
    </details>
  );
}
