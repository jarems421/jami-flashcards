import { type ReactNode } from "react";
import { Card, JamiTutorIcon } from "@/components/ui";
import {
  describeTutorStyle,
  type TutorPreferences,
} from "@/lib/ai/tutor-personalisation";
import {
  getStudyLevelShortLabel,
  type StudyLevel,
} from "@/lib/profile/study-level";
import type { TutorSaveStatus } from "@/hooks/useTutorPersonalisation";
import type { TutorFolderNotes } from "@/services/ai/tutor-personalisation";

const STATUS_COPY: Record<TutorSaveStatus, string> = {
  idle: "Changes save as you make them.",
  saving: "Saving…",
  saved: "Saved. Applies to your next question.",
  failed: "That change was not saved.",
};

/** One line of quiet status for settings that save themselves. */
export function TutorSaveIndicator({ status }: { status: TutorSaveStatus }) {
  return (
    <p
      role="status"
      className={`flex items-center gap-1.5 text-2xs ${
        status === "failed" ? "text-[var(--color-error-text)]" : "text-text-muted"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          status === "saving"
            ? "animate-pulse bg-accent"
            : status === "saved"
              ? "bg-accent"
              : status === "failed"
                ? "bg-[var(--color-error)]"
                : "bg-[var(--color-border-strong)]"
        }`}
      />
      {STATUS_COPY[status]}
    </p>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-warm-border/60 pt-3 first:border-t-0 first:pt-0">
      <dt className="text-2xs font-semibold uppercase tracking-[0.14em] text-warm-accent">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-6 text-text-secondary">{children}</dd>
    </div>
  );
}

function NoteLines({ notes }: { notes: readonly string[] }) {
  const shown = notes.slice(0, 3);
  return (
    <ul className="mt-1 space-y-1">
      {shown.map((note) => (
        <li key={note} className="flex gap-2 text-xs leading-5 text-text-muted">
          <span aria-hidden="true">–</span>
          <span className="min-w-0 break-words">{note}</span>
        </li>
      ))}
      {notes.length > shown.length ? (
        <li className="text-xs text-text-muted">
          and {notes.length - shown.length} more
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Everything on this page, read back as what Jami will actually do.
 *
 * The settings were four separate forms and a status strip of chips, and
 * nothing on the screen said what they added up to. This does -- in the
 * student's words, never the prompt's -- and it is the same set of facts the
 * tutor is given, so what it promises is what the next answer gets.
 */
export default function TutorBrief({
  studyLevel,
  studySubjects,
  preferences,
  folder,
  saveStatus,
}: {
  studyLevel: StudyLevel | null;
  studySubjects: readonly string[];
  preferences: TutorPreferences;
  folder: TutorFolderNotes | null;
  saveStatus: TutorSaveStatus;
}) {
  const style = describeTutorStyle(preferences);
  const folderKnown = folder?.course ?? folder?.subject;

  return (
    <Card tone="warm" padding="md" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-warm-border bg-warm-glow text-warm-accent">
          <JamiTutorIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-text-primary">
            What Jami works from
          </h3>
          <TutorSaveIndicator status={saveStatus} />
        </div>
      </div>

      <dl className="flex flex-col gap-3">
        <Row label="Pitched at">
          {studyLevel ? getStudyLevelShortLabel(studyLevel) : "No level set"}
          {studySubjects.length > 0 ? ` · ${studySubjects.join(", ")}` : ""}
        </Row>
        <Row label="Teaching">
          {style.length > 0 ? style.join(" · ") : "Jami decides, question by question"}
        </Row>
        <Row label="Every subject">
          {preferences.notes.length > 0 ? (
            <NoteLines notes={preferences.notes} />
          ) : (
            "No notes"
          )}
        </Row>
        {folder ? (
          <Row label={`In ${folder.name}`}>
            {folderKnown ? <span className="block">{folderKnown}</span> : null}
            {folder.notes.length > 0 ? (
              <NoteLines notes={folder.notes} />
            ) : (
              <span className="block text-text-muted">No subject notes</span>
            )}
          </Row>
        ) : null}
      </dl>

      <p className="border-t border-warm-border/60 pt-3 text-2xs leading-5 text-text-muted">
        Ask for something different in a message and Jami does that instead.
      </p>
    </Card>
  );
}
