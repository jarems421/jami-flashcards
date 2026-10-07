"use client";

import AllowanceHint from "@/components/billing/AllowanceHint";
import { Button, ElapsedTime, ProgressBar } from "@/components/ui";

function submitLabel(input: {
  generating: boolean;
  working: boolean;
  answering: boolean;
  confirmingFormat: boolean;
}) {
  if (input.working) return input.generating ? "Jami is building the paper..." : "Creating paper...";
  if (input.answering) return "Answer and continue";
  if (input.confirmingFormat) return "Confirm the paper format above";
  return input.generating ? "Generate practice paper" : "Create uploaded paper";
}

/** The builder's last row: file progress while adding files, and the button that makes the paper. */
export default function PracticePaperSubmitBar({
  generating,
  working,
  progress,
  answering,
  confirmingFormat,
  onSubmit,
}: {
  /** The paper is being generated, rather than uploaded. */
  generating: boolean;
  working: boolean;
  /** Upload progress of the files being added, as a percentage; null when none is. */
  progress: number | null;
  /** Jami asked a question, so the button sends the answer. */
  answering: boolean;
  /** Jami is waiting on a confirmed format, which is done above. */
  confirmingFormat: boolean;
  onSubmit: () => void;
}) {
  return (
    <>
      {working && progress !== null ? (
        <div>
          <div className="mb-2 flex justify-between text-xs font-medium text-text-muted">
            <span>Adding files</span>
            <span className="flex gap-2 tabular-nums">
              <ElapsedTime />
              <span>{progress}%</span>
            </span>
          </div>
          <ProgressBar progress={progress} size="sm" />
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-3 border-t border-[var(--color-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-sm text-xs leading-5 text-text-muted">
          Your paper opens in a notebook when it&apos;s ready, and you can leave this page while it&apos;s built. The
          marking guide is fixed before your attempt begins.
        </p>
        <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
          <Button
            type="button"
            size="lg"
            className="sm:min-w-[14rem] sm:justify-center"
            disabled={working || confirmingFormat}
            onClick={onSubmit}
          >
            {submitLabel({ generating, working, answering, confirmingFormat })}
          </Button>
          {/* A paper is the scarcest thing a plan includes, so its count is always beside the button. */}
          {generating ? (
            <AllowanceHint allowance="papers" mode="always" className="text-center sm:text-right" />
          ) : (
            <AllowanceHint allowance="paperMarkings" mode="low" className="text-center sm:text-right" />
          )}
        </div>
      </div>
    </>
  );
}
