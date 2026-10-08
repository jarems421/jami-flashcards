"use client";

import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { PendingTutorAttachment } from "@/hooks/useTutorAttachments";
import AllowanceHint from "@/components/billing/AllowanceHint";
import { SymbolKeyboard } from "@/components/ui";
import { MicrophoneIcon, SendIcon, StopDictationIcon } from "@/components/ai/JamiAssistantIcons";
import { TutorAttachButton, TutorPendingAttachments } from "@/components/ai/TutorAttachments";
import TutorReasoningMenu from "@/components/ai/TutorReasoningMenu";

type TutorComposerProps = {
  userId: string;
  /** A card sized to a page margin: one line to type in, and no second row. */
  compact: boolean;
  /** An answer is being written: nothing new can be sent or attached. */
  loading: boolean;
  /** Where a chat begun elsewhere started, while it is carried on here. */
  foreignThreadPlace: string | null;
  historyContextLabel: string;
  error: string | null;
  onDismissError: () => void;
  historyNotice: string | null;
  onDismissHistoryNotice: () => void;
  files: {
    pending: PendingTutorAttachment[];
    notice: string | null;
    uploading: boolean;
    ready: boolean;
    add: (files: File[]) => void;
    remove: (key: string) => void;
  };
  input: string;
  onInputChange: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: () => void;
  dictation: { supported: boolean; listening: boolean };
  onToggleDictation: () => void;
  onReasoningSaveStarted: (save: Promise<void>) => void;
  onError: (message: string) => void;
  useRelatedSources: boolean;
  onToggleRelatedSources: () => void;
};

/**
 * Where the student writes to Jami: what to know before sending, the message
 * box with what can go with it, and what Jami reads from.
 */
export default function TutorComposer({
  userId,
  compact,
  loading,
  foreignThreadPlace,
  historyContextLabel,
  error,
  onDismissError,
  historyNotice,
  onDismissHistoryNotice,
  files,
  input,
  onInputChange,
  inputRef,
  onSubmit,
  dictation,
  onToggleDictation,
  onReasoningSaveStarted,
  onError,
  useRelatedSources,
  onToggleRelatedSources,
}: TutorComposerProps) {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <>
      {foreignThreadPlace !== null ? (
        <p className="mb-3 rounded-lg border border-accent/20 bg-accent/8 px-3.5 py-2.5 text-2xs leading-relaxed text-text-secondary">
          This chat started {foreignThreadPlace}. Carry on here and Jami picks it up, now with {historyContextLabel} in front of it.
        </p>
      ) : null}
      {error ? (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-error/35 bg-error-muted px-3.5 py-3 text-xs text-[var(--color-error-text)]" role="alert">
          <span className="leading-relaxed">{error}</span>
          <button
            type="button"
            className="shrink-0 font-semibold underline decoration-current/40 underline-offset-2"
            onClick={onDismissError}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {historyNotice ? (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-warning/30 bg-warning-muted px-3.5 py-3 text-xs text-text-secondary" role="status">
          <span className="leading-relaxed">{historyNotice}</span>
          <button
            type="button"
            className="shrink-0 font-semibold underline decoration-current/40 underline-offset-2"
            onClick={onDismissHistoryNotice}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {files.notice ? (
        <p className="mb-2 px-1 text-2xs text-text-muted" role="status">
          {files.notice}
        </p>
      ) : null}
      <div
        className="relative rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-panel)] shadow-e1 transition duration-fast focus-within:border-accent/55 focus-within:ring-2 focus-within:ring-accent/15"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          const dropped = Array.from(event.dataTransfer.files);
          if (dropped.length === 0) return;
          event.preventDefault();
          if (!loading) files.add(dropped);
        }}
      >
        <TutorPendingAttachments items={files.pending} onRemove={files.remove} />
        <label htmlFor="jami-assistant-message" className="sr-only">
          Message Jami
        </label>
        <textarea
          ref={inputRef}
          id="jami-assistant-message"
          data-notebook-text-editor="true"
          rows={compact ? 1 : 2}
          value={input}
          disabled={loading}
          placeholder="Ask Jami..."
          className={`${compact ? "min-h-[3rem]" : "min-h-[5.75rem]"} w-full resize-none bg-transparent pb-2 pl-4 pr-4 pt-3 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none focus-visible:shadow-none disabled:cursor-not-allowed disabled:saturate-[0.82]`}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            // A pasted screenshot is attached; pasted text is typed as usual.
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length === 0) return;
            event.preventDefault();
            files.add(pasted);
          }}
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-2">
          <TutorReasoningMenu
            userId={userId}
            disabled={loading}
            onSaveStarted={onReasoningSaveStarted}
            onError={onError}
          />
          <div className="flex items-center gap-1.5">
            {/*
              In the composer's own toolbar rather than floating over the
              text: this row already holds the other things you do to a
              message before sending it.
            */}
            <TutorAttachButton disabled={loading} onFiles={files.add} />
            <SymbolKeyboard targetRef={inputRef} />
            {dictation.supported ? (
              <button
                type="button"
                aria-label={dictation.listening ? "Stop dictating" : "Dictate your message"}
                aria-pressed={dictation.listening}
                disabled={loading}
                className={`inline-grid h-9 w-9 place-items-center rounded-full transition duration-fast active:scale-95 disabled:cursor-not-allowed disabled:text-text-muted disabled:shadow-none ${
                  dictation.listening
                    ? "bg-error text-white shadow-e1 hover:brightness-110"
                    : "text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                }`}
                onClick={onToggleDictation}
              >
                {dictation.listening ? <StopDictationIcon /> : <MicrophoneIcon />}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Send message to Jami"
              disabled={
                loading ||
                files.uploading ||
                (!input.trim() && !dictation.listening && !files.ready)
              }
              className="inline-grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-on shadow-accent transition duration-fast hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:bg-[var(--color-glass-medium)] disabled:text-text-muted disabled:shadow-none"
              onClick={onSubmit}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
      {/* Silent until the month's questions are nearly gone, as ChatGPT does it. */}
      <AllowanceHint allowance="tutor" mode="low" className="mt-2 px-1" />
      {dictation.listening ? (
        <p
          className="mt-2 flex items-center gap-2 px-1 text-xs text-text-secondary"
          role="status"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-error"
          />
          <span>Listening. Stop to edit what you said, or send it straight away.</span>
        </p>
      ) : null}

      {compact ? (
        <p className="mt-1.5 px-1 text-2xs text-text-muted">
          Jami can make mistakes. Check important answers.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <TutorFolderSourcesSwitch on={useRelatedSources} onToggle={onToggleRelatedSources} />
          <div className="px-1.5 pt-1 text-2xs text-text-muted">
            Jami can make mistakes. Check important answers.
          </div>
        </div>
      )}
    </>
  );
}

/** Whether Jami searches the rest of the folder, folded away until it is wanted. */
function TutorFolderSourcesSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <details className="group min-w-0 flex-1 basis-[15rem] text-xs text-text-muted">
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 rounded-full px-1.5 font-medium transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 [&::-webkit-details-marker]:hidden">
        {/*
          Two marks for one control: a dot separating "Context" from the
          state, and a chevron saying it opens. Neither was carrying its
          own weight -- the dot separated a label from the thing it
          labelled, and the chevron said "expandable" next to a line that
          could say it in a word. The state is the label now, and the
          word changes when it opens.
        */}
        <span>{on ? "Folder sources on" : "Folder sources off"}</span>
        <span className="font-semibold text-accent group-open:hidden">Change</span>
        <span className="hidden font-semibold text-accent group-open:inline">Hide</span>
      </summary>
      <div className="mt-2 flex w-full items-center justify-between gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-text-primary">Use folder sources</span>
          <span className="mt-0.5 block text-2xs leading-relaxed text-text-muted">
            Jami searches everything in this folder and reads the parts that fit your question.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-label="Use folder sources"
          aria-checked={on}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
            on
              ? "border-accent/40 bg-accent/65"
              : "border-[var(--color-border-strong)] bg-[var(--color-glass-medium)]"
          }`}
          onClick={onToggle}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition duration-fast ${
              on ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </div>
    </details>
  );
}
