"use client";

import Link from "next/link";
import TutorNotesList from "@/components/ai/TutorNotesList";
import { EmptyState, Select, Skeleton } from "@/components/ui";
import { getFolderHref } from "@/lib/app/routes";
import {
  MAX_TUTOR_FOLDER_NOTES,
  SUBJECT_NOTE_SUGGESTIONS,
} from "@/lib/ai/tutor-personalisation";
import { getStudyLevelShortLabel } from "@/lib/profile/study-level";
import type {
  TutorFolderNotes as TutorFolderNotesValue,
  TutorFolderSummary,
} from "@/services/ai/tutor-personalisation";

type TutorFolderNotesProps = {
  folders: TutorFolderSummary[];
  selectedFolderId: string;
  folder: TutorFolderNotesValue | null;
  loadingFolder: boolean;
  onSelectFolder: (folderId: string) => void;
  onChange: (notes: string[]) => void;
  /**
   * `split` puts the folders in a column beside the notes from `lg` up, which
   * is the page. `compact` is a dropdown at every width, which is the drawer.
   */
  layout?: "split" | "compact";
};

function noteCountLabel(count: number) {
  return count === 0 ? "No notes" : `${count} note${count === 1 ? "" : "s"}`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-1">
      <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </span>
      <span className="truncate text-xs font-medium text-text-secondary">
        {value}
      </span>
    </span>
  );
}

/**
 * What Jami already knows about the folder, before a note is written.
 *
 * The retired guide opened by asking "Which course is this for?" of a folder
 * that already had its exam course set. Showing what is known makes the notes
 * about what is *not* -- and says where to fix the course if it is wrong.
 */
function FolderFacts({ folder }: { folder: TutorFolderNotesValue }) {
  const facts = [
    folder.course ? { label: "Course", value: folder.course } : null,
    !folder.course && folder.subject
      ? { label: "Subject", value: folder.subject }
      : null,
    folder.studyLevel
      ? { label: "Level", value: getStudyLevelShortLabel(folder.studyLevel) }
      : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-text-muted">Jami already knows</span>
        {facts.length > 0 ? (
          facts.map((fact) => <Fact key={fact.label} {...fact} />)
        ) : (
          <span className="text-xs text-text-secondary">
            only the folder&rsquo;s name
          </span>
        )}
      </div>
      <Link
        href={getFolderHref(folder.id)}
        className="shrink-0 text-xs font-semibold text-accent underline-offset-4 hover:underline"
      >
        {facts.length > 0 ? "Change in folder" : "Add a course"}
      </Link>
    </div>
  );
}

/**
 * Notes for one subject, beside the folder they belong to.
 *
 * Replaces a folder dropdown over a Markdown box, and the one-time scripted
 * chat that wrote a first document from three questions. Notes save as they
 * are made, so switching folders never loses anything and needs no prompt.
 */
export default function TutorFolderNotes({
  folders,
  selectedFolderId,
  folder,
  loadingFolder,
  onSelectFolder,
  onChange,
  layout = "compact",
}: TutorFolderNotesProps) {
  if (folders.length === 0) {
    return (
      <EmptyState
        emoji="📁"
        title="No folders yet"
        description="Subject notes belong to a folder. Make one first."
      />
    );
  }

  const selected = folders.find((entry) => entry.id === selectedFolderId);
  const shown = folder && folder.id === selectedFolderId ? folder : null;
  const split = layout === "split";

  const picker = (
    <Select
      label="Folder"
      value={selectedFolderId}
      onChange={(event) => onSelectFolder(event.target.value)}
    >
      {folders.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name}
          {entry.noteCount > 0 ? ` · ${noteCountLabel(entry.noteCount)}` : ""}
        </option>
      ))}
    </Select>
  );

  const notes =
    loadingFolder || !shown ? (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full rounded-2xl" />
        <Skeleton className="h-11 w-full rounded-2xl" />
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        <FolderFacts folder={shown} />
        <TutorNotesList
          key={shown.id}
          label={`Notes for ${shown.name}`}
          notes={shown.notes}
          max={MAX_TUTOR_FOLDER_NOTES}
          suggestions={SUBJECT_NOTE_SUGGESTIONS}
          placeholder="Use the notation from my lecture notes"
          emptyText={`Nothing yet. Notes here apply only when you're working in ${shown.name}.`}
          onChange={onChange}
        />
      </div>
    );

  if (!split) {
    return (
      <div className="flex flex-col gap-4">
        {picker}
        {notes}
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
      <div className="lg:hidden">{picker}</div>
      <nav
        aria-label="Folders"
        className="hidden max-h-[26rem] flex-col gap-1 overflow-y-auto pr-1 lg:flex"
      >
        {folders.map((entry) => {
          const active = entry.id === selectedFolderId;
          return (
            <button
              key={entry.id}
              type="button"
              aria-current={active ? "true" : undefined}
              onClick={() => onSelectFolder(entry.id)}
              className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                active
                  ? "bg-accent/10 text-text-primary shadow-e1"
                  : "text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
              }`}
            >
              <span className="min-w-0 truncate text-sm font-medium">
                {entry.name}
              </span>
              {entry.noteCount > 0 ? (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold ${
                    active
                      ? "bg-accent/20 text-text-primary"
                      : "bg-[var(--color-glass-subtle)] text-text-muted"
                  }`}
                >
                  {entry.noteCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="min-w-0">
        {selected ? (
          <h4 className="mb-3 hidden text-base font-medium tracking-tight text-text-primary lg:block">
            {selected.name}
          </h4>
        ) : null}
        {notes}
      </div>
    </div>
  );
}
