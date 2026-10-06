"use client";

import AllowanceHint from "@/components/billing/AllowanceHint";
import ExamAnswerField from "@/components/practice/ExamAnswerField";
import { Button, FormDisclosure } from "@/components/ui";
import type { ExamDraftSaveState } from "@/hooks/useExamAnswerDrafts";

const SAVE_DOT_CLASS: Record<ExamDraftSaveState, string> = {
  failed: "bg-[var(--color-error-mark)]",
  saving: "animate-pulse bg-[var(--color-warning-mark)]",
  saved: "bg-[var(--color-success-mark)]",
  idle: "bg-[var(--color-border-strong)]",
};

const SAVE_LABEL: Record<ExamDraftSaveState, string> = {
  failed: "Couldn't save just now — it will retry.",
  saving: "Saving…",
  saved: "Saved.",
  idle: "Saves as you write.",
};

function DraftSaveIndicator({ state }: { state: ExamDraftSaveState }) {
  return (
    <p aria-live="polite" className="flex items-center gap-2 text-xs text-text-muted">
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${SAVE_DOT_CLASS[state]}`} />
      {SAVE_LABEL[state]}
    </p>
  );
}

/** What will be sent if the student marks it now, said beside the button. */
function sendHint(input: {
  nothingToSend: boolean;
  onSheet: boolean;
  hasPrintedPages: boolean;
  hasInk: boolean;
  hasTypedText: boolean;
}) {
  if (input.nothingToSend) {
    if (!input.onSheet) return "Type an answer, or show your working, then mark it.";
    return input.hasPrintedPages
      ? "Write on the paper above, or type an answer, then mark it."
      : "Write on the page above, or type an answer, then mark it.";
  }
  if (input.onSheet) {
    if (input.hasInk && input.hasTypedText) return "The paper and your typed answer are both sent.";
    return input.hasInk ? "What you wrote on the paper is sent to be marked." : "Your typed answer is sent to be marked.";
  }
  return input.hasInk
    ? "Your working below is sent with this answer."
    : "Working below is optional — sent only if you use it.";
}

function markLabel(input: { submitting: boolean; hasInk: boolean; hasTypedText: boolean }) {
  if (input.submitting) return input.hasInk ? "Reading your working…" : "Marking your answer…";
  if (input.hasInk && input.hasTypedText) return "Mark answer and working";
  return input.hasInk ? "Mark my working" : "Mark answer";
}

/**
 * The typed answer, under the paper rather than over it, and only if it is
 * wanted -- and the button that sends everything to be marked.
 *
 * It sat above the working while the working was a pad and the question was a
 * picture somewhere else. Now that the paper is the page, above the paper is
 * above the question, and a box asking for an answer before the question has
 * been read is the wrong way round.
 *
 * It is also no longer how an answer is given. A student writes on the printed
 * sheet, the way they would in the exam, and the marker reads the sheet -- so
 * on a question with paper the box folds away, says what it is, and opens for
 * anyone who wants to type as well. Typing an answer out a second time to
 * satisfy a form was work the paper had already done. A question with no paper
 * has nowhere else to answer, so there the box stays the answer line it was.
 *
 * Folded, not unmounted: the field keeps its text and its autosave whether or
 * not the section is open, so closing it is putting the sheet down rather than
 * losing the page.
 */
export default function ExamAnswerPanel({
  fieldId,
  attemptId,
  prompt,
  storedText,
  onSheet,
  hasPrintedPages,
  retrying,
  hasTypedText,
  hasInk,
  nothingToSend,
  submitting,
  saveState,
  readDraft,
  onDraft,
  onShowWorking,
  onSubmit,
}: {
  fieldId: string;
  attemptId: string;
  prompt: string;
  storedText: string;
  /** The question is answered on a sheet of paper above this. */
  onSheet: boolean;
  hasPrintedPages: boolean;
  /** This is the guided second try. */
  retrying: boolean;
  hasTypedText: boolean;
  hasInk: boolean;
  nothingToSend: boolean;
  submitting: boolean;
  saveState: ExamDraftSaveState;
  readDraft(attemptId: string): string | undefined;
  onDraft(attemptId: string, text: string, storedText: string): void;
  onShowWorking: () => void;
  onSubmit: () => void;
}) {
  const field = (
    <ExamAnswerField
      key={attemptId}
      id={fieldId}
      prompt={prompt}
      attemptId={attemptId}
      storedText={storedText}
      disabled={submitting}
      readDraft={readDraft}
      onDraft={onDraft}
    />
  );

  return (
    <div data-behind-working className={`p-4 sm:p-5 ${onSheet ? "border-t border-[var(--color-border)]" : ""}`}>
      {onSheet ? (
        <FormDisclosure
          key={attemptId}
          title={retrying ? "Try your answer again" : "Type your answer"}
          summary={hasTypedText ? "Answer typed" : "Optional"}
          // Read once, at mount: an answer already typed opens with it showing.
          defaultOpen={hasTypedText}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <label htmlFor={fieldId} className="text-sm text-text-muted">
              Marked alongside what you wrote on the paper.
            </label>
            <DraftSaveIndicator state={saveState} />
          </div>
          {field}
        </FormDisclosure>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <label htmlFor={fieldId} className="text-base font-semibold tracking-tight text-text-primary">
              {retrying ? "Try your answer again" : "Your answer"}
            </label>
            <DraftSaveIndicator state={saveState} />
          </div>
          {field}
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onSheet ? null : (
          <Button type="button" variant="secondary" className="md:hidden" onClick={onShowWorking}>
            {hasInk ? "Open working" : "Show your working"}
          </Button>
        )}
        <p className={`text-xs text-text-muted ${onSheet ? "" : "hidden md:block"}`}>
          {sendHint({ nothingToSend, onSheet, hasPrintedPages, hasInk, hasTypedText })}
        </p>
        <Button
          className="ml-auto"
          disabled={submitting || nothingToSend}
          onClick={onSubmit}
          data-tutorial-target="mark-answer"
        >
          {markLabel({ submitting, hasInk, hasTypedText })}
        </Button>
      </div>
      <AllowanceHint allowance="answers" mode="low" offerPlans={false} className="mt-2 text-right" />
    </div>
  );
}
