"use client";

import { Skeleton } from "@/components/ui";
import PracticePaperSourcePicker from "@/components/practice/PracticePaperSourcePicker";
import PracticeStep from "@/components/practice/PracticeStep";
import type { usePracticePaperSourceChoice } from "@/hooks/usePracticePaperSourceChoice";
import type { Source } from "@/lib/material/sources";
import { MAX_PRACTICE_PAPER_SOURCE_IDS } from "@/lib/practice/practice-papers";

const SUPPORTING_FILE_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,.pdf,.docx,.pptx,.txt";

/**
 * Files added for one build only. They are uploaded with the request and
 * removed once the paper is built, and together with the chosen sources they
 * stay within what one paper can read.
 */
function SupportingFiles({
  files,
  chosenSourceCount,
  disabled,
  onChange,
}: {
  files: File[];
  chosenSourceCount: number;
  disabled: boolean;
  onChange: (files: File[]) => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--color-border-strong)] p-4">
      <label className="text-sm font-semibold text-text-primary" htmlFor="paper-supporting-files">
        Temporary supporting files
      </label>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        Optional PDFs, documents or images for this build only. They are removed after the paper is built.
      </p>
      <input
        id="paper-supporting-files"
        className="mt-3 block w-full text-xs text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-accent/10 file:px-3 file:py-2 file:font-semibold file:text-accent"
        type="file"
        multiple
        accept={SUPPORTING_FILE_ACCEPT}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            Array.from(event.target.files ?? []).slice(0, Math.max(0, MAX_PRACTICE_PAPER_SOURCE_IDS - chosenSourceCount))
          )
        }
      />
      {files.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-text-muted">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>{file.name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The folder's own material for a paper.
 *
 * For a picked school course it is an optional extra: the course's format,
 * checked topics and real questions already say what the paper is, so only a
 * manual pick is offered, with supporting files for this build. Otherwise --
 * an uploaded paper, or a course typed in -- Jami proposes the most useful
 * sources and the student confirms them or picks their own.
 */
export default function PracticePaperSourcesStep({
  step,
  optional,
  sources,
  loading,
  choice,
  supportingFiles,
  onSupportingFilesChange,
  disabled,
}: {
  step: number;
  optional: boolean;
  sources: Source[];
  loading: boolean;
  choice: ReturnType<typeof usePracticePaperSourceChoice>;
  /** Supporting files are offered, for a generated paper on a picked course; null otherwise. */
  supportingFiles: File[] | null;
  onSupportingFilesChange: (files: File[]) => void;
  disabled: boolean;
}) {
  return (
    <PracticeStep
      step={step}
      title={optional ? "Add your own material?" : "Add your module material"}
      description={
        optional
          ? "Optional. Jami already writes to your course's format and topics, modelled on its real past papers. Add notes or a teacher's paper only if you want the questions to follow them."
          : "Past papers, the module handbook and lecture notes make the paper match your exam. Jami suggests the most useful ones in this folder."
      }
    >
      {loading ? (
        <Skeleton className="h-16 rounded-2xl" />
      ) : optional ? (
        <PracticePaperSourcePicker
          sources={sources}
          proposedSources={choice.proposedSources}
          automaticConfirmed={false}
          selectedIds={choice.selectedIds}
          automatic={false}
          manualOnly
          disabled={disabled}
          onAutomaticChange={() => undefined}
          onConfirmAutomatic={() => undefined}
          onChange={choice.setSelectedIds}
        />
      ) : (
        <PracticePaperSourcePicker
          sources={sources}
          proposedSources={choice.proposedSources}
          automaticConfirmed={choice.automaticConfirmed}
          selectedIds={choice.selectedIds}
          automatic={choice.automatic}
          disabled={disabled}
          onAutomaticChange={choice.setAutomatic}
          onConfirmAutomatic={choice.confirmProposal}
          onChange={choice.setSelectedIds}
        />
      )}
      {supportingFiles ? (
        <SupportingFiles
          files={supportingFiles}
          chosenSourceCount={choice.chosenIds.length}
          disabled={disabled}
          onChange={onSupportingFilesChange}
        />
      ) : null}
    </PracticeStep>
  );
}
