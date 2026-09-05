"use client";

import { useState } from "react";
import StudyLevelSelect from "@/components/study/StudyLevelSelect";
import { Button, Input } from "@/components/ui";
import {
  getStudyLevelShortLabel,
  studyLevelNeedsSubjects,
  type StudyLevel,
} from "@/lib/profile/study-level";
import {
  MAX_STUDY_SUBJECTS,
  MAX_STUDY_SUBJECT_LENGTH,
  normalizeStudySubject,
} from "@/lib/profile/study-subjects";

type TutorStudyProfileFormProps = {
  studyLevel: StudyLevel | null;
  studySubjects: readonly string[];
  /** The level a folder forces for this conversation, if one does. */
  folderLevel?: StudyLevel | null;
  folderName?: string | null;
  saving: boolean;
  onSave: (input: {
    studyLevel: StudyLevel | null;
    studySubjects: readonly string[];
  }) => Promise<boolean>;
};

function RemoveIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-2.5 w-2.5">
      <path
        d="m3 3 6 6M9 3l-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The level Jami pitches at, and the courses that give it meaning.
 *
 * This was a card on the Account page, two screens away from the tutor that
 * reads it, and accounts were routinely found with it never set. It belongs
 * beside the rest of what a student tells Jami about themselves.
 *
 * From A level upwards the level alone stops describing anyone -- "University"
 * covers Law and Astrophysics -- so those levels ask for the subjects and the
 * form will not save without at least one. Below that a level is a good enough
 * description on its own and the field stays out of the way.
 */
export default function TutorStudyProfileForm({
  studyLevel,
  studySubjects,
  folderLevel = null,
  folderName = null,
  saving,
  onSave,
}: TutorStudyProfileFormProps) {
  const [level, setLevel] = useState<StudyLevel | "">(studyLevel ?? "");
  const [subjects, setSubjects] = useState<string[]>([...studySubjects]);
  const [entry, setEntry] = useState("");

  const needsSubjects = studyLevelNeedsSubjects(level || null);
  /*
   * Shown when the level asks for subjects, and also whenever there are any.
   *
   * Without the second half, dropping from University back to GCSE hid the
   * field while the stored list stayed in the prompt and stayed visible in the
   * status chip -- a student could see "2 subjects" with nowhere to change
   * them. The list is deliberately kept across a level change, so the way to
   * edit it has to be kept too.
   */
  const showSubjects = needsSubjects || subjects.length > 0;
  const full = subjects.length >= MAX_STUDY_SUBJECTS;
  const dirty =
    (level || null) !== studyLevel ||
    subjects.length !== studySubjects.length ||
    subjects.some((subject, index) => subject !== studySubjects[index]);
  const missingSubjects = needsSubjects && subjects.length === 0;

  const addSubject = () => {
    const subject = normalizeStudySubject(entry);
    if (!subject || full) return;
    const duplicate = subjects.some(
      (existing) => existing.toLowerCase() === subject.toLowerCase()
    );
    setEntry("");
    if (duplicate) return;
    setSubjects((current) => [...current, subject]);
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || saving || missingSubjects) return;
        void onSave({ studyLevel: level || null, studySubjects: subjects });
      }}
    >
      <StudyLevelSelect
        value={level}
        emptyLabel="Not set"
        disabled={saving}
        onChange={(next) => setLevel(next)}
      />

      {showSubjects ? (
        <div>
          <label
            htmlFor="tutor-study-subject"
            className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
          >
            Your subjects
            {needsSubjects ? null : (
              <span className="font-normal text-text-muted"> (optional)</span>
            )}
          </label>

          {subjects.length > 0 ? (
            <ul className="mb-2 flex flex-wrap gap-1.5">
              {subjects.map((subject) => (
                <li key={subject}>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/45 bg-accent/10 py-1 pl-3 pr-1.5 text-xs font-medium text-text-primary">
                    {subject}
                    <button
                      type="button"
                      disabled={saving}
                      aria-label={`Remove ${subject}`}
                      onClick={() =>
                        setSubjects((current) =>
                          current.filter((entryName) => entryName !== subject)
                        )
                      }
                      className="grid h-4 w-4 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-accent/20 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                    >
                      <RemoveIcon />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex gap-2">
            <Input
              id="tutor-study-subject"
              value={entry}
              disabled={saving || full}
              maxLength={MAX_STUDY_SUBJECT_LENGTH}
              placeholder={full ? "That is the limit" : "Maths, Biology…"}
              containerClassName="min-w-0 flex-1"
              className="py-2.5"
              onChange={(event) => setEntry(event.target.value)}
              onKeyDown={(event) => {
                // Enter adds a subject here rather than submitting: the form's
                // Save is a separate, deliberate press.
                if (event.key !== "Enter") return;
                event.preventDefault();
                addSubject();
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={saving || full || !entry.trim()}
              onClick={addSubject}
            >
              Add
            </Button>
          </div>

          <p className="mt-1.5 text-2xs text-text-muted">
            {missingSubjects
              ? "Add at least one so Jami knows your courses."
              : `Jami uses these for examples and notation. ${subjects.length}/${MAX_STUDY_SUBJECTS}.`}
          </p>
        </div>
      ) : null}

      {/*
        The folder override, said once and only when it is actually in force.
        Editing the account default while a folder quietly outranks it is the
        kind of thing that makes a student stop trusting the screen.
      */}
      {folderLevel && folderName ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2 text-2xs leading-5 text-text-muted">
          {folderName} overrides this with{" "}
          <span className="font-semibold text-text-secondary">
            {getStudyLevelShortLabel(folderLevel)}
          </span>
          .
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || saving || missingSubjects}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {dirty && !saving ? (
          <span className="text-xs text-text-muted">Unsaved</span>
        ) : null}
      </div>
    </form>
  );
}
