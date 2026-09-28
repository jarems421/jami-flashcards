"use client";

import { useId, useMemo, useState } from "react";
import { JAMI_ASSISTANT_MAX_SOURCE_IDS } from "@/lib/ai/jami-assistant";
import { getSourceTypeLabel } from "@/lib/app/tutor-drafts";
import { toggleSourceSelection } from "@/lib/material/source-selectors";
import type { Source } from "@/lib/material/sources";

/**
 * Which of the student's material Jami reads for this conversation -- one
 * source or several, chosen here.
 *
 * Asking about several at once used to be a separate mode in the Library:
 * start selecting, tick sources, then ask. Here it is simply the list of what
 * is in use, with a way to add more, wherever a conversation starts or is
 * already going. The same fifteen-source limit applies as everywhere Jami is
 * handed material, and at least one source always stays chosen: there is no
 * conversation about nothing.
 */

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-2.5 w-2.5">
      <path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export type TutorSourcePickerProps = {
  sources: readonly Source[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  /** Shown under the picker while it is open, e.g. that a change starts a new chat. */
  changeNote?: string;
  disabled?: boolean;
  /** Starts with the list showing, for a surface that opens straight onto choosing. */
  defaultOpen?: boolean;
};

export default function TutorSourcePicker({
  sources,
  selectedIds,
  onChange,
  changeNote,
  disabled = false,
  defaultOpen = false,
}: TutorSourcePickerProps) {
  const listId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const max = JAMI_ASSISTANT_MAX_SOURCE_IDS;

  const byId = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const selected = selectedIds.flatMap((id) => {
    const source = byId.get(id);
    return source ? [source] : [];
  });
  const full = selectedIds.length >= max;
  // Most recently used first: the one a student wants is nearly always recent.
  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...sources]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .filter((source) => !needle || source.title.toLowerCase().includes(needle));
  }, [query, sources]);

  const remove = (id: string) => {
    if (selectedIds.length <= 1) return;
    onChange(selectedIds.filter((existing) => existing !== id));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-text-muted">Using</span>
        {selected.map((source) => (
          <span
            key={source.id}
            className="inline-flex max-w-full items-center gap-1 rounded-xl border border-accent/40 bg-accent/10 py-0.5 pl-1 pr-1 text-xs font-semibold text-text-primary"
          >
            {/* The name opens the list too: nothing here only looks pressable. */}
            <button
              type="button"
              disabled={disabled}
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen(true)}
              className="min-w-0 truncate rounded-lg px-1.5 py-0.5 transition hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            >
              {source.title}
            </button>
            {selected.length > 1 ? (
              <button
                type="button"
                disabled={disabled}
                aria-label={`Stop using ${source.title}`}
                onClick={() => remove(source.id)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-accent/20 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
              >
                <CloseIcon />
              </button>
            ) : (
              <span className="w-1" aria-hidden="true" />
            )}
          </span>
        ))}
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex min-h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-glass-subtle)] hover:text-[var(--color-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:text-text-muted"
        >
          {open ? "Done" : selected.length > 0 ? "+ Add more" : "+ Choose material"}
        </button>
      </div>

      {open ? (
        <div id={listId} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-2 shadow-e2">
          <label className="sr-only" htmlFor={`${listId}-find`}>
            Find material
          </label>
          <input
            id={`${listId}-find`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find your notes, papers and links"
            className="app-field min-h-10 w-full rounded-xl px-3 text-sm outline-none"
          />
          <ul aria-label="Your material" className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
            {listed.length === 0 ? (
              <li className="px-3 py-2 text-xs text-text-muted">Nothing matches that.</li>
            ) : (
              listed.map((source) => {
                const checked = selectedIds.includes(source.id);
                const locked = (checked && selectedIds.length <= 1) || (!checked && full);
                return (
                  <li key={source.id}>
                    <label
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                        locked && !checked ? "opacity-50" : "cursor-pointer hover:bg-[var(--color-glass-subtle)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || locked}
                        onChange={() => onChange(toggleSourceSelection(selectedIds, source.id, max))}
                        className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{source.title}</span>
                      <span className="shrink-0 text-2xs text-text-muted">
                        {source.subject ? `${source.subject} · ` : ""}
                        {getSourceTypeLabel(source.type)}
                      </span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
          <p className="px-3 pb-1 pt-2 text-2xs text-text-muted">
            {selectedIds.length} of {max} chosen{full ? " — that's the most Jami can read at once" : ""}
          </p>
        </div>
      ) : null}

      {open && changeNote ? <p className="text-2xs leading-5 text-text-muted">{changeNote}</p> : null}
    </div>
  );
}
