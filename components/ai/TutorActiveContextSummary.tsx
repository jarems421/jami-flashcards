import type { TutorFolderSummary } from "@/services/ai/tutor-personalisation";
import { getStudyLevelLabel, type StudyLevel } from "@/lib/profile/study-level";

/**
 * What Jami is actually working from, in the student's own terms.
 *
 * A surface that does not know which folders its material is in is not the same
 * as one that knows the answer is none, and saying "none apply" when the truth
 * is "not established here" is the kind of small lie that makes a student stop
 * believing the rest of the screen.
 */
export function describeFolderScope(input: {
  activeFolderIds?: readonly string[];
  activeFolderName?: string;
  hasInstructions: boolean;
}) {
  if (!input.activeFolderIds) {
    return "Your subject notes apply whenever the thing you are asking about sits in one folder.";
  }
  if (input.activeFolderIds.length > 1) {
    return "This material belongs to more than one folder, so no subject notes are being applied.";
  }
  if (input.activeFolderIds.length === 0) {
    return "This material is not in a folder, so no subject notes apply.";
  }
  return input.hasInstructions
    ? `Using your notes for ${input.activeFolderName ?? "this folder"}`
    : `No notes written for ${input.activeFolderName ?? "this folder"} yet`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-text-secondary">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-xs leading-5 text-text-muted sm:text-sm">
        {children}
      </span>
    </li>
  );
}

export default function TutorActiveContextSummary({
  activeFolderIds,
  activeFolder,
  accountStudyLevel,
  activeCount,
}: {
  activeFolderIds?: readonly string[];
  activeFolder: TutorFolderSummary | null;
  accountStudyLevel: StudyLevel | null;
  activeCount: number;
}) {
  const level = activeFolder?.studyLevel ?? accountStudyLevel;

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:p-5">
      <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
        What Jami is using
      </p>
      <ul className="mt-3 space-y-2">
        <Row label="Level">
          {level ? (
            <>
              {getStudyLevelLabel(level)}
              {activeFolder?.studyLevel ? " — set by this folder" : ""}
            </>
          ) : (
            "Not set, so Jami judges it from your question"
          )}
        </Row>
        <Row label="Subject">
          {describeFolderScope({
            activeFolderIds,
            activeFolderName: activeFolder?.name,
            hasInstructions: activeFolder?.hasInstructions === true,
          })}
        </Row>
        <Row label="Preferences">
          {activeCount === 0
            ? "None set, so Jami adapts to each question"
            : `${activeCount} of your choices${activeCount === 1 ? " is" : " are"} in use`}
        </Row>
      </ul>
    </div>
  );
}
