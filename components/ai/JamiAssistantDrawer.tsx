"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  formatJamiAssistantUsedContext,
  type JamiAssistantContext,
  type JamiAssistantUsedContext,
} from "@/lib/ai/jami-assistant";
import { sendJamiAssistantMessage } from "@/services/ai/jami-assistant";
import { JamiSparklesIcon, StudyText } from "@/components/ui";

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

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4">
      <path d="M12 18V6m0 0-4.5 4.5M12 6l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

  if (!open || typeof document === "undefined") return null;

  return createPortal(
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
        className="relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[32rem] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] shadow-[var(--shadow-shell)]"
        onKeyDown={handleFocusTrap}
      >
        <header className="border-b border-[var(--color-border)] px-4 py-3.5 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
                <JamiSparklesIcon className="h-[1.1rem] w-[1.1rem]" />
              </div>
              <div className="min-w-0">
                <h2 id="jami-assistant-title" className="text-base font-semibold leading-tight text-text-primary">
                  Jami
                </h2>
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {contextLabel}
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close Jami assistant"
              title="Close"
              className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
              onClick={() => onOpenChange(false)}
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {messages.length === 0 ? (
            <div className="flex min-h-full flex-col justify-center py-5">
              <div className="mx-auto max-w-sm text-center">
                <h3 className="text-lg font-semibold text-text-primary">
                  How can I help?
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  Ask about what you are studying, or choose a useful starting point.
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
                          ? "rounded-br-md bg-accent text-white"
                          : "rounded-bl-md border border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-primary"
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

          <div className="relative rounded-[1.3rem] border border-[var(--color-border-strong)] bg-[var(--color-surface-panel)] shadow-[0_8px_24px_rgba(8,2,26,0.08)] transition duration-fast focus-within:border-accent/55 focus-within:ring-2 focus-within:ring-accent/15">
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
              className="min-h-[3.5rem] w-full resize-none bg-transparent py-3 pl-4 pr-14 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed disabled:saturate-[0.82]"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <button
              type="button"
              aria-label="Send message to Jami"
              disabled={loading || !input.trim()}
              className="absolute bottom-2 right-2 inline-grid h-9 w-9 place-items-center rounded-full bg-accent text-white shadow-[0_6px_16px_rgba(124,92,255,0.22)] transition duration-fast hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:bg-[var(--color-glass-medium)] disabled:text-text-muted disabled:shadow-none"
              onClick={() => void sendMessage(input)}
            >
              <SendIcon />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <details className="group min-w-0 flex-1 basis-[15rem] text-xs text-text-muted">
              <summary className="flex min-h-7 cursor-pointer list-none items-center gap-1.5 rounded-full px-1.5 font-medium transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 [&::-webkit-details-marker]:hidden">
                <span>Context</span>
                <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current opacity-45" />
                <span>{useRelatedSources ? "Related material on" : "Related material off"}</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="h-3.5 w-3.5 transition-transform duration-fast group-open:rotate-180"
                >
                  <path
                    d="m4 6 4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </summary>
              <div className="mt-2 flex w-full items-center justify-between gap-4 rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-text-primary">
                    Use related Jami material
                  </span>
                  <span className="mt-0.5 block text-[0.68rem] leading-relaxed text-text-muted">
                    Jami may choose up to five relevant sources when you ask.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Use related Jami material"
                  aria-checked={useRelatedSources}
                  className={`relative h-6 w-11 shrink-0 rounded-full border transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                    useRelatedSources
                      ? "border-accent/40 bg-accent/65"
                      : "border-[var(--color-border-strong)] bg-[var(--color-glass-medium)]"
                  }`}
                  onClick={() => setUseRelatedSources((current) => !current)}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition duration-fast ${
                      useRelatedSources ? "left-5" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            </details>
            <div className="px-1.5 pt-1 text-[0.65rem] text-text-muted">
              Jami can make mistakes. Check important answers.
            </div>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
