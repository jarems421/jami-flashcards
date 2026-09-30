"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { JamiTutorIcon } from "@/components/ui";
import type { StudyMaterialBriefMessage } from "@/lib/ai/study-material-brief";
import { STUDY_MATERIAL_BRIEF_MAX_MESSAGES } from "@/lib/ai/study-material-brief";
import { askStudyMaterialBrief } from "@/services/ai/source-drafts";

type StudyMaterialFocusChatProps = {
  sourceId: string;
  disabled: boolean;
  onBriefChange: (brief: string) => void;
};

/**
 * Telling Jami what to make before it makes it.
 *
 * A short exchange rather than a settings form: "only chapters 3 and 4",
 * "skip the history, more on the equations", and Jami says back what it will
 * cover and whether the source has it. What they settle on steers both Make
 * buttons below.
 */
export default function StudyMaterialFocusChat({
  sourceId,
  disabled,
  onBriefChange,
}: StudyMaterialFocusChatProps) {
  const [messages, setMessages] = useState<StudyMaterialBriefMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const text = input.trim();
    if (!text || sending || disabled) return;
    const next = [...messages, { role: "student" as const, text }].slice(-STUDY_MATERIAL_BRIEF_MAX_MESSAGES);
    setMessages(next);
    setInput("");
    setSending(true);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { reply, brief } = await askStudyMaterialBrief({ sourceId, messages: next, signal: controller.signal });
      setMessages((current) => [...current, { role: "jami", text: reply }]);
      onBriefChange(brief);
    } catch (sendError) {
      if (controller.signal.aborted) return;
      // The student's words are kept in the box so a failed turn costs nothing to retry.
      setMessages(messages);
      setInput(text);
      setError(sendError instanceof Error ? sendError.message : "Jami could not reply just now.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
    }
  };

  const clear = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    setError("");
    setSending(false);
    onBriefChange("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <JamiTutorIcon className="h-4 w-4 shrink-0 text-accent" />
          <span className="text-sm font-semibold text-text-primary">Tell Jami what to focus on</span>
          <span className="text-xs text-text-muted">Optional</span>
        </div>
        {messages.length > 0 ? (
          <button
            type="button"
            disabled={disabled}
            className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            onClick={clear}
          >
            Start over
          </button>
        ) : null}
      </div>

      {messages.length > 0 ? (
        <div className="mt-3 space-y-2" aria-live="polite">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`flex ${message.role === "student" ? "justify-end" : "justify-start"}`}
            >
              <p
                className={`max-w-[88%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-5 ${
                  message.role === "student"
                    ? "rounded-br-md bg-accent text-accent-on"
                    : "rounded-bl-md border border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-primary"
                }`}
              >
                {message.text}
              </p>
            </div>
          ))}
          {sending ? (
            <div className="flex justify-start" role="status">
              <span className="app-chip inline-flex items-center gap-2 rounded-xl rounded-bl-md px-3 py-2 text-xs text-text-muted">
                Jami is reading the source
                <span className="ai-thinking-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-1.5 text-xs leading-5 text-text-muted">
          Say which parts matter, or what to skip. Otherwise Jami covers the whole source.
        </p>
      )}

      <div className="mt-3 flex items-end gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-panel)] p-1.5 transition duration-fast focus-within:border-accent/55 focus-within:ring-2 focus-within:ring-accent/15">
        <label htmlFor={`focus-chat-${sourceId}`} className="sr-only">
          What should Jami focus on?
        </label>
        <textarea
          id={`focus-chat-${sourceId}`}
          rows={1}
          value={input}
          disabled={disabled || sending}
          maxLength={600}
          placeholder={
            messages.length > 0
              ? "Anything to change?"
              : "e.g. Just the equations in section 3, skip the history"
          }
          className="max-h-28 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          aria-label="Send to Jami"
          disabled={disabled || sending || !input.trim()}
          className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-accent-on shadow-accent transition duration-fast hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:bg-[var(--color-glass-medium)] disabled:text-text-muted disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          onClick={() => void send()}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
            <path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-xs leading-5 text-[var(--color-error-text)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
