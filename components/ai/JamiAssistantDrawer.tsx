"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  formatJamiAssistantUsedContext,
  type JamiAssistantContext,
  type JamiAssistantUsedContext,
} from "@/lib/ai/jami-assistant";
import { sendJamiAssistantMessage } from "@/services/ai/jami-assistant";
import { Button, StudyText } from "@/components/ui";

export type JamiAssistantQuickAction =
  | string
  | {
      label: string;
      prompt: string;
    };

type JamiAssistantDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resetKey: string;
  contextLabel: string;
  getContext: () => JamiAssistantContext | Promise<JamiAssistantContext>;
  quickActions?: readonly JamiAssistantQuickAction[];
};

type DrawerMessage = {
  role: "user" | "assistant";
  text: string;
  used?: JamiAssistantUsedContext[];
};

function SparkleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M12 3.5 13.35 8a4 4 0 0 0 2.65 2.65L20.5 12 16 13.35A4 4 0 0 0 13.35 16L12 20.5 10.65 16A4 4 0 0 0 8 13.35L3.5 12 8 10.65A4 4 0 0 0 10.65 8L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path d="m4 4 17 8-17 8 3-8-3-8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M7 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export default function JamiAssistantDrawer({
  open,
  onOpenChange,
  resetKey,
  contextLabel,
  getContext,
  quickActions = [],
}: JamiAssistantDrawerProps) {
  const [messages, setMessages] = useState<DrawerMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useRelatedSources, setUseRelatedSources] = useState(true);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const previousResetKeyRef = useRef(resetKey);
  const requestIdRef = useRef(0);
  const requestPendingRef = useRef(false);
  const normalizedQuickActions = quickActions.map((action) =>
    typeof action === "string" ? { label: action, prompt: action } : action
  );

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    requestIdRef.current += 1;
    requestPendingRef.current = false;
    setMessages([]);
    setInput("");
    setLoading(false);
    setError(null);
    onOpenChange(false);
  }, [onOpenChange, resetKey]);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const previousBodyOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousBodyOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [loading, messages, open]);

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim();
      if (!message || requestPendingRef.current) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      requestPendingRef.current = true;
      setMessages((current) => [...current, { role: "user", text: message }]);
      setInput("");
      setLoading(true);
      setError(null);

      try {
        const context = await getContext();
        const response = await sendJamiAssistantMessage({
          message,
          history: messages.map((historyMessage) => ({
            role: historyMessage.role === "assistant" ? ("model" as const) : ("user" as const),
            text: historyMessage.text,
          })),
          context,
          useRelatedSources,
        });

        if (requestIdRef.current !== requestId) return;
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            text: response.reply,
            used: response.used,
          },
        ]);
      } catch (requestError) {
        if (requestIdRef.current !== requestId) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Jami could not answer that just now. Please try again."
        );
      } finally {
        if (requestIdRef.current === requestId) {
          requestPendingRef.current = false;
          setLoading(false);
        }
      }
    },
    [getContext, messages, useRelatedSources]
  );

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const handleFocusTrap = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter(
      (element) =>
        !element.hasAttribute("hidden") && element.getClientRects().length > 0
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <button
        type="button"
        aria-label="Close Jami assistant"
        tabIndex={-1}
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="jami-assistant-title"
        className="relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[34rem] flex-col overflow-hidden border-l border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] shadow-[var(--shadow-shell)]"
        onKeyDown={handleFocusTrap}
      >
        <header className="relative overflow-hidden border-b border-[var(--color-border)] px-5 py-5 sm:px-7 sm:py-6">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-24 h-52 w-52 rounded-full bg-accent/10 blur-3xl"
          />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="app-selected flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-accent shadow-[0_12px_28px_rgba(124,92,255,0.16)]">
                <SparkleIcon />
              </div>
              <div className="min-w-0">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-text-muted">
                  Jami assistant
                </div>
                <h2 id="jami-assistant-title" className="mt-1 text-xl font-semibold text-text-primary sm:text-2xl">
                  Study with Jami
                </h2>
                <div className="mt-2 inline-flex max-w-full items-center rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-1 text-xs text-text-secondary">
                  <span className="truncate">Using {contextLabel}</span>
                </div>
              </div>
            </div>
            <Button
              ref={closeButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close Jami assistant"
              onClick={() => onOpenChange(false)}
            >
              <CloseIcon />
            </Button>
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {messages.length === 0 ? (
            <div className="flex min-h-full flex-col justify-center py-6">
              <div className="mx-auto max-w-sm text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent">
                  <SparkleIcon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-text-primary">
                  What would help right now?
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  Ask about this study context. Jami can combine general knowledge with relevant material from your workspace.
                </p>
              </div>
              {normalizedQuickActions.length > 0 ? (
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {normalizedQuickActions.map((action) => (
                    <button
                      key={`${action.label}:${action.prompt}`}
                      type="button"
                      disabled={loading}
                      className="app-chip rounded-full px-3.5 py-2 text-xs font-medium text-text-secondary transition duration-fast hover:border-border-strong hover:bg-[var(--color-glass-medium)] hover:text-text-primary disabled:cursor-not-allowed disabled:saturate-[0.82]"
                      onClick={() => void sendMessage(action.prompt)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4" aria-live="polite">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[90%]">
                    <div
                      className={`rounded-[1.35rem] px-4 py-3 text-sm leading-relaxed ${
                        message.role === "user"
                          ? "app-selected rounded-br-md"
                          : "app-chip rounded-bl-md text-text-primary"
                      }`}
                    >
                      <StudyText text={message.text} className="whitespace-pre-wrap" />
                    </div>
                    {message.role === "assistant" ? (
                      <div className="mt-1.5 px-1 text-[0.68rem] leading-relaxed text-text-muted">
                        {message.used && message.used.length > 0
                          ? formatJamiAssistantUsedContext(message.used)
                          : "Used: General knowledge"}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {loading ? (
                <div className="flex justify-start">
                  <div className="app-chip rounded-[1.35rem] rounded-bl-md px-4 py-3 text-sm text-text-muted" role="status">
                    <span className="inline-flex items-center gap-2">
                      Jami is thinking
                      <span className="inline-flex gap-1" aria-hidden="true">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
                      </span>
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-7 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            role="switch"
            aria-checked={useRelatedSources}
            className="mb-3 flex w-full items-center justify-between gap-4 rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3.5 py-3 text-left transition duration-fast hover:border-border-strong"
            onClick={() => setUseRelatedSources((current) => !current)}
          >
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-text-primary">
                Use related Jami material
              </span>
              <span className="mt-0.5 block text-[0.68rem] leading-relaxed text-text-muted">
                Let Jami choose up to five relevant sources for this question.
              </span>
            </span>
            <span
              aria-hidden="true"
              className={`relative h-6 w-11 shrink-0 rounded-full border transition duration-fast ${
                useRelatedSources
                  ? "border-accent/40 bg-accent/65"
                  : "border-[var(--color-border-strong)] bg-[var(--color-glass-medium)]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition duration-fast ${
                  useRelatedSources ? "left-5" : "left-0.5"
                }`}
              />
            </span>
          </button>

          {error ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-[1.25rem] border border-error/35 bg-error-muted px-3.5 py-3 text-xs text-[var(--color-error-text)]" role="alert">
              <span className="leading-relaxed">{error}</span>
              <button
                type="button"
                className="shrink-0 font-semibold underline decoration-current/40 underline-offset-2"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            <label htmlFor="jami-assistant-message" className="sr-only">
              Message Jami
            </label>
            <textarea
              ref={inputRef}
              id="jami-assistant-message"
              rows={2}
              value={input}
              disabled={loading}
              placeholder="Ask Jami..."
              className="app-field min-h-[3.25rem] flex-1 resize-none rounded-[1.35rem] px-4 py-3 text-sm leading-relaxed outline-none transition disabled:cursor-not-allowed disabled:saturate-[0.82]"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <Button
              type="button"
              size="icon"
              aria-label="Send message to Jami"
              disabled={loading || !input.trim()}
              onClick={() => void sendMessage(input)}
            >
              <SendIcon />
            </Button>
          </div>
          <div className="mt-2 text-center text-[0.65rem] text-text-muted">
            Jami can make mistakes. Check important answers.
          </div>
        </footer>
      </div>
    </div>
  );
}
