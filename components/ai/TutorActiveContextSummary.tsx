import type { TutorFolderSummary } from "@/services/ai/tutor-personalisation";
import {
  getStudyLevelShortLabel,
  type StudyLevel,
} from "@/lib/profile/study-level";

/**
 * What Jami is actually working from, in as few words as it can be said.
 *
 * This was a bordered panel with a heading and three label-and-sentence rows,
 * and in a 32rem drawer every sentence wrapped into a paragraph pushed against
 * the left edge -- a block of reading in front of somebody who opened settings
 * to change one thing. It is now three chips: a student can take all of it in
 * without reading it, which is the only job a status line has.
 */
export function describeFolderScope(input: {
  activeFolderIds?: readonly string[];
  activeFolderName?: string;
  hasInstructions: boolean;
}) {
  // A surface that does not know which folders its material is in is not the
  // same as one that knows the answer is none, and saying "none apply" when the
  // truth is "not established here" is a small lie the rest of the screen pays
  // for.
  if (!input.activeFolderIds) return "Set per folder";
  if (input.activeFolderIds.length > 1) return "Several folders — off";
  if (input.activeFolderIds.length === 0) return "No folder — off";
  const name = input.activeFolderName ?? "this folder";
  return input.hasInstructions ? `${name} — on` : `${name} — none yet`;
}

function Chip({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] py-1 pl-2 pr-3">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          active ? "bg-accent" : "bg-[var(--color-border-strong)]"
        }`}
      />
      <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </span>
      <span className="truncate text-xs font-medium text-text-secondary">
        {value}
      </span>
    </span>
  );
}

export default function TutorActiveContextSummary({
  activeFolderIds,
  activeFolder,
  accountStudyLevel,
  accountStudySubjects = [],
  activeCount,
}: {
  activeFolderIds?: readonly string[];
  activeFolder: TutorFolderSummary | null;
  accountStudyLevel: StudyLevel | null;
  accountStudySubjects?: readonly string[];
  activeCount: number;
}) {
  const level = activeFolder?.studyLevel ?? accountStudyLevel;
  const subjectCount = accountStudySubjects.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <h3 className="sr-only">What Jami is using</h3>
      <Chip
        label="Level"
        active={Boolean(level)}
        value={
          level
            ? `${getStudyLevelShortLabel(level)}${
                activeFolder?.studyLevel
                  ? " (folder)"
                  : subjectCount > 0
                    ? ` · ${subjectCount} subject${subjectCount === 1 ? "" : "s"}`
                    : ""
              }`
            : "Not set"
        }
      />
      <Chip
        label="Notes"
        active={activeFolder?.hasInstructions === true}
        value={describeFolderScope({
          ...(activeFolderIds ? { activeFolderIds } : {}),
          ...(activeFolder?.name ? { activeFolderName: activeFolder.name } : {}),
          hasInstructions: activeFolder?.hasInstructions === true,
        })}
      />
      <Chip
        label="Style"
        active={activeCount > 0}
        value={activeCount === 0 ? "Default" : `${activeCount} changed`}
      />
    </div>
  );
}
