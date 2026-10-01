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
};

function noteCountLabel(count: number) {
  return count === 0 ? "No notes" : `${count} note${count === 1 ? "" : "s"}`;
}

/**
 * Notes for one subject: pick the folder, see in one line what Jami already
 * knows about it, then the notes.
 *
 * It was a folder list beside a dropdown of the same folders, a table of
 * facts and the notes, which read as three things competing. One column now,
 * in the order a student uses it. Notes save as they are made, so switching
 * folders never loses anything.
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

  const shown = folder && folder.id === selectedFolderId ? folder : null;
  const known = shown
    ? [shown.course || shown.subject, shown.studyLevel ? getStudyLevelShortLabel(shown.studyLevel) : ""]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="max-w-2xl space-y-4">
      <div className="max-w-sm">
        <Select label="Folder" value={selectedFolderId} onChange={(event) => onSelectFolder(event.target.value)}>
          {folders.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
              {entry.noteCount > 0 ? ` · ${noteCountLabel(entry.noteCount)}` : ""}
            </option>
          ))}
        </Select>
      </div>

      {loadingFolder || !shown ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-2/3 rounded-full" />
          <Skeleton className="h-11 w-full rounded-2xl" />
        </div>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-text-secondary">
            <span>{known ? `Jami knows: ${known}` : "Jami knows only the folder's name."}</span>
            <Link
              href={getFolderHref(shown.id)}
              className="text-xs font-semibold text-accent underline-offset-4 hover:underline"
            >
              {known ? "Change" : "Add a course"}
            </Link>
          </p>
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
  );
}
