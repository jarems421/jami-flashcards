"use client";

import Link from "next/link";
import { Fragment } from "react";
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
};

function noteCountLabel(count: number) {
  return count === 0 ? "No notes" : `${count} note${count === 1 ? "" : "s"}`;
}

/**
 * What Jami already knows about the folder, before a note is written.
 *
 * The retired guide opened by asking "Which course is this for?" of a folder
 * that already had its exam course set. Showing what is known makes the notes
 * about what is *not* -- and says where to fix the course if it is wrong.
 *
 * Label and value in two columns rather than a row of chips: a course name is
 * the longest thing here, and a chip truncated it in any card narrower than a
 * page.
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
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-text-muted">Jami already knows</p>
        <Link
          href={getFolderHref(folder.id)}
          className="shrink-0 text-xs font-semibold text-accent underline-offset-4 hover:underline"
        >
          {facts.length > 0 ? "Change in folder" : "Add a course"}
        </Link>
      </div>
      {facts.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {facts.map((fact) => (
            <Fragment key={fact.label}>
              <dt className="text-xs leading-5 text-text-muted">{fact.label}</dt>
              <dd className="min-w-0 break-words text-sm leading-5 text-text-primary">
                {fact.value}
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className="mt-1 text-sm leading-5 text-text-secondary">
          Only the folder&rsquo;s name.
        </p>
      )}
    </div>
  );
}

/**
 * Notes for one subject, beside the folder they belong to.
 *
 * Replaces a folder dropdown over a Markdown box, and the one-time scripted
 * chat that wrote a first document from three questions. Notes save as they
 * are made, so switching folders never loses anything and needs no prompt.
 *
 * It lays itself out by the room it is given, not by the screen: a list of
 * folders beside the notes once both fit, a dropdown above them until then.
 * `.tutor-folder-notes` in globals.css holds the width. Choosing by the screen
 * put a 14rem folder list beside a column of notes a few words wide, because on
 * a laptop the page's own sidebar had already taken the room.
 */
export default function TutorFolderNotes({
  folders,
  selectedFolderId,
  folder,
  loadingFolder,
  onSelectFolder,
  onChange,
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

  return (
    <div className="tutor-folder-notes">
      <div className="tutor-folder-notes-grid">
        <div className="tutor-folder-notes-picker">
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
        </div>

        <nav
          aria-label="Folders"
          className="tutor-folder-notes-list max-h-[28rem] flex-col gap-1 overflow-y-auto pr-1"
        >
          {folders.map((entry) => {
            const active = entry.id === selectedFolderId;
            return (
              <button
                key={entry.id}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelectFolder(entry.id)}
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                  active
                    ? "border-accent/40 bg-accent/10 text-text-primary shadow-e1"
                    : "border-transparent text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
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

        <div className="flex min-w-0 flex-col gap-4">
          {selected ? (
            <h4 className="tutor-folder-notes-title text-base font-medium tracking-tight text-text-primary">
              {selected.name}
            </h4>
          ) : null}
          {loadingFolder || !shown ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full rounded-2xl" />
              <Skeleton className="h-11 w-full rounded-2xl" />
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
