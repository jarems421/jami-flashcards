"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button, JamiTutorIcon } from "@/components/ui";
import {
  SKY_PATTERN_REQUEST_MAX_LENGTH,
  type SkyPatternTurn,
} from "@/lib/constellation/sky-pattern";

type SkyPatternChatProps = {
  disabled: boolean;
  /** Resolves with Jami's reply once the sky is arranged, or throws what to say. */
  onSend: (request: string, history: SkyPatternTurn[]) => Promise<string>;
  canUndo: boolean;
  onUndo: () => void;
};

type ChatMessage = SkyPatternTurn & { id: number; failed?: boolean };

/** The latest few only: this is a sky with a chat beside it, not a chat. */
const VISIBLE_MESSAGES = 4;

export default function SkyPatternChat({
  disabled,
  onSend,
  canUndo,
  onUndo,
}: SkyPatternChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const nextIdRef = useRef(0);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = draft.trim();
    if (!request || sending || disabled) return;

    // Failed replies are left out, so a follow-up builds on what actually happened.
    const history = messages
      .filter((message) => !message.failed)
      .map(({ role, text }) => ({ role, text }));
    const id = nextIdRef.current;
    nextIdRef.current += 2;

    setMessages((current) => [...current, { id, role: "student", text: request }]);
    setDraft("");
    setSending(true);
    try {
      const reply = await onSend(request, history);
      setMessages((current) => [...current, { id: id + 1, role: "jami", text: reply }]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: id + 1,
          role: "jami",
          text: error instanceof Error ? error.message : "Jami could not arrange your sky just now.",
          failed: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const visible = messages.slice(-VISIBLE_MESSAGES);

  return (
    <section aria-label="Ask Jami to arrange your stars" className="app-subtle-panel rounded-2xl p-3">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <JamiTutorIcon className="h-4 w-4" />
          Jami
        </div>
        {canUndo ? (
          <Button type="button" size="sm" variant="ghost" onClick={onUndo} disabled={sending}>
            Undo
          </Button>
        ) : null}
      </div>

      {visible.length > 0 || sending ? (
        <ol className="mt-2 flex flex-col gap-1.5" aria-live="polite">
          {visible.map((message) => (
            <li
              key={message.id}
              className={`max-w-sm rounded-2xl px-3 py-1.5 text-xs leading-5 ${
                message.role === "student"
                  ? "self-end bg-selected-bg text-selected-text"
                  : message.failed
                    ? "self-start bg-glass-subtle text-danger-text"
                    : "self-start bg-glass-subtle text-text-primary"
              }`}
            >
              {message.text}
            </li>
          ))}
          {sending ? (
            <li className="self-start animate-pulse rounded-2xl bg-glass-subtle px-3 py-1.5 text-xs leading-5 text-text-muted">
              Arranging your stars…
            </li>
          ) : null}
        </ol>
      ) : (
        <p className="mt-1 text-xs leading-5 text-text-muted">
          {disabled
            ? "Earn at least two stars and Jami can arrange them into a pattern."
            : "Describe a shape and Jami will arrange the stars you already have."}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-2.5 flex items-center gap-2">
        <input
          type="text"
          aria-label="What should Jami make with your stars?"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={SKY_PATTERN_REQUEST_MAX_LENGTH}
          disabled={disabled || sending}
          placeholder="A heart, a cat, the Plough…"
          className="app-field min-h-10 min-w-0 flex-1 rounded-full px-4 text-sm outline-none"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send to Jami"
          data-tutorial-target="sky-ask"
          disabled={disabled || sending || !draft.trim()}
          className="!size-10 shrink-0 rounded-full"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            className="size-4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </Button>
      </form>
    </section>
  );
}
