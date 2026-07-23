"use client";

import type { Source } from "@/lib/practice/sources";
import { MAX_TUTOR_SOURCE_SELECTION } from "@/lib/study/library-management";
import { Button, FeedbackBanner, Textarea } from "@/components/ui";
import {
  SourceActionIcon,
  SourceTypeIcon,
  SourceWorkspaceDrawer,
} from "./SourceWorkspace";
import type {
  SourceTutorMessage,
  SourceWorkspaceFeedback,
} from "./source-workspace-types";

type SourceTutorDrawerProps = {
  open: boolean;
  selectedSources: Source[];
  additionalSources: Source[];
  sourceIds: string[];
  message: string;
  messages: SourceTutorMessage[];
  feedback: SourceWorkspaceFeedback | null;
  busyAction: string | null;
  historyLoading: boolean;
  showSourcePicker: boolean;
  onClose: () => void;
  onDismissFeedback: () => void;
  onMessageChange: (message: string) => void;
  onAsk: () => void;
  onClearConversation: () => void;
  onToggleSourcePicker: () => void;
  onToggleSource: (sourceId: string) => void;
};

export default function SourceTutorDrawer({
  open,
  selectedSources,
  additionalSources,
  sourceIds,
  message,
  messages,
  feedback,
  busyAction,
  historyLoading,
  showSourcePicker,
  onClose,
  onDismissFeedback,
  onMessageChange,
  onAsk,
  onClearConversation,
  onToggleSourcePicker,
  onToggleSource,
}: SourceTutorDrawerProps) {
  return (
    <SourceWorkspaceDrawer
      open={open}
      eyebrow="Jami Tutor"
      title={`Ask about ${selectedSources[0]?.title ?? "this source"}`}
      onClose={onClose}
      footer={
        <div className="space-y-3">
          <Textarea
            label="Question"
            placeholder="What would you like help with?"
            rows={4}
            value={message}
            data-drawer-autofocus="true"
            onChange={(event) => onMessageChange(event.target.value)}
          />
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={
              busyAction === "source-tutor" ||
              historyLoading ||
              sourceIds.length === 0 ||
              !message.trim()
            }
            onClick={onAsk}
          >
            <SourceActionIcon name="sparkles" className="mr-2 h-4 w-4" />
            {busyAction === "source-tutor" ? "Reading..." : "Ask Jami"}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            autoDismissMs={0}
            onDismiss={onDismissFeedback}
          />
        ) : null}

        <section className="app-subtle-panel rounded-[1.15rem] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Using for this request
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-text-primary">
                {selectedSources[0]?.title ?? "No source selected"}
                {selectedSources.length > 1
                  ? ` +${selectedSources.length - 1} more`
                  : ""}
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                When you press Ask, these sources and your question are sent
                to Google Gemini. Jami saves this conversation for follow-ups
                until you clear it.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1 sm:shrink-0 sm:justify-end">
              {additionalSources.length > 0 ? (
                <button
                  type="button"
                  aria-expanded={showSourcePicker}
                  aria-controls="tutor-extra-source-picker"
                  disabled={
                    busyAction === "source-tutor" ||
                    busyAction === "clear-tutor-history"
                  }
                  onClick={onToggleSourcePicker}
                  className="min-h-11 rounded-full px-3 text-xs font-semibold text-text-secondary transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {showSourcePicker
                    ? "Done"
                    : selectedSources.length > 1
                      ? "Change sources"
                      : "Add another source"}
                </button>
              ) : null}
              {messages.length > 0 ? (
                <button
                  type="button"
                  disabled={
                    busyAction === "source-tutor" ||
                    busyAction === "clear-tutor-history"
                  }
                  onClick={onClearConversation}
                  className="min-h-11 rounded-full px-3 text-xs font-semibold text-text-muted transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyAction === "clear-tutor-history"
                    ? "Clearing..."
                    : "Clear conversation"}
                </button>
              ) : null}
            </div>
          </div>

          {showSourcePicker ? (
            <div
              id="tutor-extra-source-picker"
              className="mt-4 overflow-hidden rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-surface-panel)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-xs text-text-muted">
                <span>Additional sources</span>
                <span>
                  {sourceIds.length}/{MAX_TUTOR_SOURCE_SELECTION}
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {additionalSources.map((source) => {
                  const checked = sourceIds.includes(source.id);
                  const limitReached =
                    !checked && sourceIds.length >= MAX_TUTOR_SOURCE_SELECTION;
                  const selectionLocked = Boolean(busyAction) || historyLoading;
                  return (
                    <label
                      key={source.id}
                      className={
                        "flex min-h-12 items-center gap-3 border-b border-[var(--color-border)] px-3 text-sm last:border-b-0 " +
                        (limitReached || selectionLocked
                          ? "cursor-not-allowed text-text-muted"
                          : "cursor-pointer text-text-primary hover:bg-[var(--color-glass-subtle)]")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={limitReached || selectionLocked}
                        onChange={() => onToggleSource(source.id)}
                        className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                      />
                      <SourceTypeIcon
                        type={source.type}
                        className="h-4 w-4 shrink-0 text-text-muted"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {source.title}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        <section aria-label="Tutor conversation" aria-live="polite">
          {historyLoading ? (
            <p className="text-sm leading-6 text-text-muted">
              Loading this conversation...
            </p>
          ) : messages.length === 0 ? (
            <p className="text-sm leading-6 text-text-muted">
              Ask for an explanation, summary, or comparison.
            </p>
          ) : (
            <div className="space-y-3">
              {messages.map((tutorMessage, index) => (
                <div
                  key={tutorMessage.role + "-" + index}
                  className={
                    tutorMessage.role === "model"
                      ? "border-l-2 border-[var(--color-border-strong)] py-1 pl-4 text-sm leading-6 text-text-primary"
                      : "rounded-[1.1rem] bg-[var(--color-glass-subtle)] p-4 text-sm leading-6 text-text-secondary"
                  }
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                    <span>{tutorMessage.role === "model" ? "Jami" : "You"}</span>
                    {tutorMessage.role === "model" && tutorMessage.outcome ? (
                      <span
                        className={
                          tutorMessage.outcome === "grounded"
                            ? "text-text-secondary"
                            : tutorMessage.outcome === "partial"
                              ? "text-warm-accent"
                              : "text-text-muted"
                        }
                      >
                        {tutorMessage.outcome === "grounded"
                          ? "Grounded answer"
                          : tutorMessage.outcome === "partial"
                            ? "Partial answer"
                            : "Not enough source material"}
                      </span>
                    ) : null}
                  </div>
                  <div className="whitespace-pre-wrap">{tutorMessage.text}</div>
                  {tutorMessage.role === "model" &&
                  tutorMessage.sourcesUsed &&
                  tutorMessage.sourcesUsed.length > 0 ? (
                    <div className="mt-2 text-xs leading-5 text-text-muted">
                      Sources used: {tutorMessage.sourcesUsed.map((source) => source.title).join(", ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </SourceWorkspaceDrawer>
  );
}
