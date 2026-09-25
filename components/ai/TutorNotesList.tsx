"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";
import {
  cleanTutorNote,
  MAX_TUTOR_NOTE_LENGTH,
} from "@/lib/ai/tutor-personalisation";

type TutorNotesListProps = {
  /** Names the list for screen readers: "Notes for every subject". */
  label: string;
  notes: readonly string[];
  max: number;
  suggestions: readonly string[];
  placeholder: string;
  emptyText: string;
  onChange: (notes: string[]) => void;
};

function RemoveIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
      <path
        d="m3 3 6 6M9 3l-6 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
      <path
        d="M6 2.5v7M2.5 6h7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function sameNote(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * One note, read as a line and edited in place.
 *
 * Tapping the text is the edit: a separate pencil beside every line doubled the
 * controls on a list whose whole appeal is that it is short.
 */
function NoteRow({
  note,
  onEdit,
  onRemove,
}: {
  note: string;
  onEdit: (next: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  // Enter and Escape both leave through blur, so an edit is saved exactly once.
  const cancelledRef = useRef(false);

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const next = cleanTutorNote(draft);
    if (!next) onRemove();
    else if (next !== note) onEdit(next);
  };

  return (
    <li className="group flex items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] py-2 pl-3.5 pr-2 transition duration-fast hover:border-[var(--color-border-strong)]">
      {/* As wide as an idea's plus, so a note and an idea start their text in line. */}
      <span
        aria-hidden="true"
        className="grid h-8 w-5 shrink-0 place-items-center"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      {editing ? (
        <Input
          aria-label="Edit note"
          // Focused because the tap that opened it was a tap on this text.
          ref={(node) => node?.focus()}
          value={draft}
          maxLength={MAX_TUTOR_NOTE_LENGTH}
          containerClassName="min-w-0 flex-1"
          className="py-1.5"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              cancelledRef.current = true;
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <button
          type="button"
          aria-label={`Edit note: ${note}`}
          className="min-w-0 flex-1 rounded-lg py-1 text-left text-sm leading-6 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          onClick={() => {
            setDraft(note);
            setEditing(true);
          }}
        >
          {note}
        </button>
      )}
      <button
        type="button"
        aria-label={`Remove note: ${note}`}
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        onClick={onRemove}
      >
        <RemoveIcon />
      </button>
    </li>
  );
}

/**
 * A short list of things Jami should keep in mind, one line each.
 *
 * It replaces two text boxes -- a Markdown document per folder and an
 * "Anything else?" box under the style choices -- that asked students to write
 * prose for a model. A list is quicker to start, easy to keep tidy, and is
 * what the model is handed anyway: every line becomes one bullet.
 *
 * Each change saves as it is made. There is nothing to lose by navigating away,
 * so there is no Save button and no discard prompt.
 */
export default function TutorNotesList({
  label,
  notes,
  max,
  suggestions,
  placeholder,
  emptyText,
  onChange,
}: TutorNotesListProps) {
  const [entry, setEntry] = useState("");
  const full = notes.length >= max;
  const ideas = suggestions
    .filter((idea) => !notes.some((note) => sameNote(note, idea)))
    .slice(0, 3);

  const add = (value: string) => {
    const note = cleanTutorNote(value);
    if (!note || full) return;
    if (!notes.some((existing) => sameNote(existing, note))) {
      onChange([...notes, note]);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    add(entry);
    setEntry("");
  };

  return (
    <div className="flex flex-col gap-3">
      {notes.length > 0 ? (
        <ul aria-label={label} className="flex flex-col gap-2">
          {notes.map((note, index) => (
            <NoteRow
              key={note}
              note={note}
              onEdit={(next) =>
                onChange(
                  notes
                    .map((existing, at) => (at === index ? next : existing))
                    .filter(
                      (existing, at, list) =>
                        list.findIndex((other) => sameNote(other, existing)) ===
                        at
                    )
                )
              }
              onRemove={() => onChange(notes.filter((_, at) => at !== index))}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-3 text-sm leading-6 text-text-muted">
          {emptyText}
        </p>
      )}

      <form onSubmit={submit} className="flex gap-2">
        <Input
          aria-label={`Add to ${label.toLowerCase()}`}
          value={entry}
          disabled={full}
          maxLength={MAX_TUTOR_NOTE_LENGTH}
          placeholder={full ? `That's the limit of ${max}` : placeholder}
          containerClassName="min-w-0 flex-1"
          className="py-2.5"
          onChange={(event) => setEntry(event.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={full || !entry.trim()}
        >
          Add
        </Button>
      </form>

      {/*
        One idea a row, in a single list, rather than pills wrapping around
        each other: three sentences of different lengths never made a tidy
        cloud, and a row keeps each one readable in a narrow card.
      */}
      {ideas.length > 0 && !full ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-text-muted">Ideas to start from</p>
          <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)]">
            {ideas.map((idea) => (
              <li key={idea}>
                <button
                  type="button"
                  aria-label={`Add note: ${idea}`}
                  className="group flex w-full items-start gap-3 py-2.5 pl-3.5 pr-4 text-left text-sm leading-5 text-text-secondary transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/45"
                  onClick={() => add(idea)}
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-accent/35 bg-accent/10 text-accent transition duration-fast group-hover:bg-accent/20">
                    <PlusIcon />
                  </span>
                  <span className="min-w-0 flex-1">{idea}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
