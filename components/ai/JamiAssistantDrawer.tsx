"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  formatJamiAssistantUsedContext,
  JAMI_ASSISTANT_MAX_HISTORY_MESSAGES,
  type JamiAssistantContext,
  type JamiAssistantFollowUp,
  type JamiAssistantUsedContext,
} from "@/lib/ai/jami-assistant";
import {
  getJamiAssistantContextKey,
  getJamiAssistantSavedContext,
  type JamiAssistantThread,
} from "@/lib/ai/jami-assistant-history";
import { sendJamiAssistantMessage } from "@/services/ai/jami-assistant";
import {
  deleteJamiAssistantThread,
  getJamiAssistantThreadMessages,
  getJamiAssistantThreads,
  renameJamiAssistantThread,
  saveJamiAssistantTurn,
  toDrawerMessages,
} from "@/services/ai/jami-assistant-history";
import { auth } from "@/services/firebase/client";
import JamiAssistantHistory from "@/components/ai/JamiAssistantHistory";
import AiResponse from "@/components/ai/AiResponse";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  JamiTutorIcon,
  StudyText,
} from "@/components/ui";

/**
 * A chip offered before the conversation starts. Most send a prompt, but a
 * surface can also offer an action that does something else entirely, such as
 * drafting flashcards from the source being discussed.
 */
/**
 * What Jami says while the student waits.
 *
 * Escalating by elapsed time rather than cycling at random, so a long wait
 * reads as progress instead of noise, and nothing claims to be nearly done
 * before it plausibly is. The last one lands well inside the 45s timeout.
 */
const WAITING_LABELS: Array<{ text: string; after: number }> = [
  { text: "Jami is thinking", after: 0 },
  { text: "Cooking something up", after: 4_000 },
  { text: "Still going", after: 9_000 },
  { text: "Nearly there", after: 18_000 },
];

export type JamiAssistantQuickAction =
  | string
  | {
      label: string;
      prompt: string;
    }
  | {
      label: string;
      run: () => void | Promise<void>;
    };

type JamiAssistantDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resetKey: string;
  contextKey: string;
  contextLabel: string;
  historyContextLabel: string;
  getContext: () => JamiAssistantContext | Promise<JamiAssistantContext>;
  quickActions?: readonly JamiAssistantQuickAction[];
  /**
   * Short note shown above the starting points, for surfaces where Jami works
   * differently from what a student would assume. Only rendered before the
   * conversation begins.
   */
  emptyStateNote?: ReactNode;
};

type DrawerMessage = {
  role: "user" | "assistant";
  text: string;
  used?: JamiAssistantUsedContext[];
  followUps?: JamiAssistantFollowUp[];
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

function HistoryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-[1.05rem] w-[1.05rem]">
      <path
        d="M4.6 5.3A7 7 0 1 1 3 10m1.6-4.7V2.8m0 2.5H2.1M10 6.3V10l2.6 1.6"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-[1.05rem] w-[1.05rem]">
      <path
        d="M10 4v12M4 10h12"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function JamiAssistantDrawer({
  open,
  onOpenChange,
  resetKey,
  contextKey,
  contextLabel,
  historyContextLabel,
  getContext,
  quickActions = [],
  emptyStateNote,
}: JamiAssistantDrawerProps) {
  const [messages, setMessages] = useState<DrawerMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threads, setThreads] = useState<JamiAssistantThread[]>([]);
  const [activeThread, setActiveThread] = useState<JamiAssistantThread | null>(null);
  const [useRelatedSources, setUseRelatedSources] = useState(true);
  /*
   * Wide screens have room for the drawer to sit beside the work rather than
   * over it. Jami is meant to nudge you towards an answer you are looking at,
   * which does not work if opening it hides the card. Below this the page is
   * too narrow to show both, so it stays a modal sheet.
  */
  const [sidePanel, setSidePanel] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousResetKeyRef = useRef(resetKey);
  const requestIdRef = useRef(0);
  const requestPendingRef = useRef(false);
  /**
   * The in-flight answer, so leaving can stop it.
   *
   * Bumping `requestIdRef` only made the drawer ignore what came back; the
   * route carried on generating and the request stayed charged. Dropping the
   * fetch is what actually tells the server to stop.
   */
  const requestAbortRef = useRef<AbortController | null>(null);
  const abandonActiveRequest = useCallback(() => {
    requestIdRef.current += 1;
    requestPendingRef.current = false;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
  }, []);
  const normalizedQuickActions = quickActions.map((action) =>
    typeof action === "string" ? { label: action, prompt: action } : action
  );

  /*
   * Once the first words arrive there is a streamed assistant message on the
   * end of the list, so the waiting state has served its purpose.
   */
  const answerHasStarted =
    loading && messages[messages.length - 1]?.role === "assistant";

  const [waitingStage, setWaitingStage] = useState(0);

  useEffect(() => {
    if (!loading || answerHasStarted) {
      setWaitingStage(0);
      return;
    }

    // Escalates rather than cycling, so the wait reads as progress. Nothing
    // here claims to be nearly finished before it plausibly is.
    const timers = WAITING_LABELS.slice(1).map((_, index) =>
      setTimeout(() => setWaitingStage(index + 1), WAITING_LABELS[index + 1].after)
    );

    return () => timers.forEach(clearTimeout);
  }, [answerHasStarted, loading]);

  const waitingLabel = WAITING_LABELS[waitingStage].text;

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    abandonActiveRequest();
    setMessages([]);
    setInput("");
    setLoading(false);
    setError(null);
    setHistoryNotice(null);
    setHistoryOpen(false);
    setThreadLoading(false);
    setActiveThread(null);
    onOpenChange(false);
  }, [abandonActiveRequest, onOpenChange, resetKey]);

  const refreshThreads = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setThreads([]);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setThreads(await getJamiAssistantThreads(user.uid));
    } catch (loadError) {
      setHistoryError(
        loadError instanceof Error
          ? loadError.message
          : "Your previous chats could not be loaded."
      );
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshThreads();
  }, [open, refreshThreads]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = () => setSidePanel(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [abandonActiveRequest, historyOpen, loading, messages, open, threadLoading]);

  const startNewChat = useCallback(() => {
    abandonActiveRequest();
    setMessages([]);
    setInput("");
    setLoading(false);
    setError(null);
    setHistoryNotice(null);
    setHistoryOpen(false);
    setThreadLoading(false);
    setActiveThread(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [abandonActiveRequest]);

  const openThread = useCallback(async (thread: JamiAssistantThread) => {
    const user = auth.currentUser;
    if (!user) {
      setHistoryError("Sign in again to open your saved chats.");
      return;
    }
    abandonActiveRequest();
    setThreadLoading(true);
    setHistoryError(null);
    setError(null);
    setHistoryNotice(null);
    try {
      const storedMessages = await getJamiAssistantThreadMessages(user.uid, thread.id);
      setMessages(toDrawerMessages(storedMessages));
      setActiveThread(thread);
      setHistoryOpen(false);
    } catch (loadError) {
      setHistoryError(
        loadError instanceof Error
          ? loadError.message
          : "That chat could not be opened."
      );
    } finally {
      setThreadLoading(false);
    }
  }, [abandonActiveRequest]);

  const renameThread = useCallback(
    async (thread: JamiAssistantThread, title: string) => {
      const user = auth.currentUser;
      if (!user) throw new Error("Sign in again to rename this chat.");
      const renamedTitle = await renameJamiAssistantThread(user.uid, thread.id, title);
      setThreads((current) =>
        current.map((candidate) =>
          candidate.id === thread.id
            ? { ...candidate, title: renamedTitle, updatedAt: Date.now() }
            : candidate
        )
      );
      setActiveThread((current) =>
        current?.id === thread.id ? { ...current, title: renamedTitle } : current
      );
    },
    []
  );

  const removeThread = useCallback(
    async (thread: JamiAssistantThread) => {
      const user = auth.currentUser;
      if (!user) throw new Error("Sign in again to delete this chat.");
      await deleteJamiAssistantThread(user.uid, thread.id);
      setThreads((current) =>
        current.filter((candidate) => candidate.id !== thread.id)
      );
      if (activeThread?.id === thread.id) {
        setActiveThread(null);
        setHistoryNotice(null);
        setError(null);
        setInput("");
        setLoading(false);
        abandonActiveRequest();
        setMessages([]);
      }
    },
    [abandonActiveRequest, activeThread?.id]
  );

  const viewingForeignThread =
    activeThread !== null && activeThread.contextKey !== contextKey;
  const latestCurrentThread = threads.find(
    (thread) => thread.contextKey === contextKey && thread.id !== activeThread?.id
  );

  const sendMessage = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim();
      if (!message || requestPendingRef.current || viewingForeignThread) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      requestPendingRef.current = true;
      const abortController = new AbortController();
      requestAbortRef.current = abortController;
      setMessages((current) => [...current, { role: "user", text: message }]);
      setInput("");
      setLoading(true);
      setError(null);
      setHistoryNotice(null);

      // Tracks whether a streamed placeholder message is on screen, so it can
      // be settled on success or cleared if generation fails part-way through.
      let streaming = false;

      try {
        const context = await getContext();
        const savedContext = getJamiAssistantSavedContext(context);
        const resolvedContextKey = getJamiAssistantContextKey(savedContext);
        if (resolvedContextKey !== contextKey) {
          throw new Error("The study context changed. Open Jami again and retry.");
        }
        // The answer streams in, so a placeholder is appended on the first
        // chunk and then updated in place. The receipt and follow-ups only
        // arrive once the whole response has been validated.
        const response = await sendJamiAssistantMessage(
          {
            message,
            history: messages
              .slice(-JAMI_ASSISTANT_MAX_HISTORY_MESSAGES)
              .map((historyMessage) => ({
                role:
                  historyMessage.role === "assistant"
                    ? ("model" as const)
                    : ("user" as const),
                text: historyMessage.text,
              })),
            context,
            useRelatedSources,
          },
          (textSoFar) => {
            if (requestIdRef.current !== requestId) return;
            setMessages((current) => {
              if (!streaming) {
                streaming = true;
                return [...current, { role: "assistant", text: textSoFar }];
              }
              const next = [...current];
              next[next.length - 1] = { ...next[next.length - 1], text: textSoFar };
              return next;
            });
          },
          abortController.signal
        );

        if (requestIdRef.current !== requestId) return;
        const assistantMessage: DrawerMessage = {
          role: "assistant",
          text: response.reply,
          used: response.used,
          followUps: response.followUps,
        };
        // Settle on the validated reply, replacing the streamed placeholder
        // rather than trusting the deltas that produced it.
        setMessages((current) =>
          streaming
            ? [...current.slice(0, -1), assistantMessage]
            : [...current, assistantMessage]
        );

        const user = auth.currentUser;
        if (user) {
          try {
            const savedThread = await saveJamiAssistantTurn({
              userId: user.uid,
              thread: activeThread ?? undefined,
              context: savedContext,
              contextKey: resolvedContextKey,
              contextLabel: historyContextLabel,
              userMessage: message,
              assistantMessage: {
                text: response.reply,
                used: response.used,
                followUps: response.followUps,
              },
            });
            if (requestIdRef.current !== requestId) return;
            setActiveThread(savedThread);
            setThreads((current) => [
              savedThread,
              ...current.filter((thread) => thread.id !== savedThread.id),
            ]);
          } catch {
            // The answer already reached the student; only persisting it to
            // history failed. That is reported in the drawer rather than
            // thrown, so a history outage cannot discard a good reply.
            if (requestIdRef.current === requestId) {
              setHistoryNotice(
                "Jami answered, but this turn could not be added to chat history."
              );
            }
          }
        }
      } catch (requestError) {
        if (requestIdRef.current !== requestId) return;
        // Abandoning the answer is something the student did; it is not a
        // failure to report back to them.
        if (abortController.signal.aborted) return;
        // Drop any partially streamed answer so an incomplete reply is not
        // left sitting above the error.
        if (streaming) setMessages((current) => current.slice(0, -1));
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Jami could not answer that just now. Please try again."
        );
      } finally {
        if (requestAbortRef.current === abortController) {
          requestAbortRef.current = null;
        }
        if (requestIdRef.current === requestId) {
          requestPendingRef.current = false;
          setLoading(false);
        }
      }
    },
    [
      activeThread,
      contextKey,
      getContext,
      historyContextLabel,
      messages,
      useRelatedSources,
      viewingForeignThread,
    ]
  );

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  return (
    <Dialog
      open={open}
      modal={!sidePanel}
      initialFocusRef={inputRef}
      className={`fixed inset-0 flex justify-end ${
        sidePanel ? "pointer-events-none" : ""
      }`}
      onDismiss={() => onOpenChange(false)}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" />
      <DialogPanel
        data-notebook-text-editor="true"
        className="pointer-events-auto relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[32rem] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] shadow-shell"
        /*
          The panel colour is a few percent translucent, which reads as depth
          over the scrim but lets the card show through once the scrim is gone.
          As a side panel it sits on an opaque base so the same colour stays,
          and the work behind it does not bleed into the conversation.
        */
        style={
          sidePanel
            ? {
                backgroundColor: "var(--color-surface-base)",
                backgroundImage:
                  "linear-gradient(var(--color-surface-panel-strong), var(--color-surface-panel-strong))",
              }
            : undefined
        }
      >
        <header className="border-b border-[var(--color-border)] px-4 py-3.5 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
                <JamiTutorIcon className="h-[1.35rem] w-[1.35rem]" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold leading-tight text-text-primary">
                  Jami
                </DialogTitle>
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {historyOpen
                    ? "Chat history"
                    : viewingForeignThread
                      ? "Saved chat · read only"
                      : contextLabel}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                aria-label={historyOpen ? "Return to current Jami chat" : "Open Jami chat history"}
                title={historyOpen ? "Current chat" : "Chat history"}
                className={`inline-grid h-10 w-10 place-items-center rounded-full transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
                  historyOpen
                    ? "bg-accent/12 text-accent"
                    : "text-text-muted hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                }`}
                onClick={() => setHistoryOpen((current) => !current)}
              >
                <HistoryIcon />
              </button>
              <button
                type="button"
                aria-label="Start a new Jami chat"
                title="New chat"
                className="inline-grid h-10 w-10 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                onClick={startNewChat}
              >
                <NewChatIcon />
              </button>
              <button
                type="button"
                aria-label="Close Jami assistant"
                title="Close"
                className="inline-grid h-10 w-10 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                onClick={() => onOpenChange(false)}
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {historyOpen ? (
            <JamiAssistantHistory
              threads={threads}
              loading={historyLoading}
              error={historyError}
              onOpen={(thread) => void openThread(thread)}
              onNew={startNewChat}
              onRename={renameThread}
              onDelete={removeThread}
            />
          ) : threadLoading ? (
            <div className="flex min-h-full items-center justify-center gap-2 text-sm text-text-muted" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
              Opening chat
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-full flex-col justify-center py-5">
              <div className="mx-auto max-w-sm text-center">
                <h3 className="text-lg font-semibold text-text-primary">
                  How can I help?
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  Ask about what you are studying, or choose a useful starting point.
                </p>
                {emptyStateNote ? (
                  <p className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2 text-xs leading-5 text-text-muted">
                    {emptyStateNote}
                  </p>
                ) : null}
              </div>
              {latestCurrentThread ? (
                <button
                  type="button"
                  className="mx-auto mt-5 flex max-w-full items-center gap-2 rounded-full border border-accent/25 bg-accent/8 px-3.5 py-2 text-xs font-medium text-accent transition duration-fast hover:border-accent/40 hover:bg-accent/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                  onClick={() => void openThread(latestCurrentThread)}
                >
                  <HistoryIcon />
                  <span className="truncate">Continue {latestCurrentThread.title}</span>
                </button>
              ) : null}
              {normalizedQuickActions.length > 0 ? (
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {normalizedQuickActions.map((action) => (
                    <button
                      key={"prompt" in action ? `${action.label}:${action.prompt}` : action.label}
                      type="button"
                      disabled={loading}
                      className="app-chip rounded-full px-3.5 py-2 text-xs font-medium text-text-secondary transition duration-fast hover:border-border-strong hover:bg-[var(--color-glass-medium)] hover:text-text-primary disabled:cursor-not-allowed disabled:saturate-[0.82]"
                      onClick={() =>
                        "prompt" in action ? void sendMessage(action.prompt) : void action.run()
                      }
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
                      className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                        message.role === "user"
                          ? "rounded-br-md bg-accent text-white"
                          : "rounded-bl-md border border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-primary"
                      }`}
                    >
                      {message.role === "assistant" ? (
                        <AiResponse content={message.text} className="select-text" />
                      ) : (
                        <StudyText
                          text={message.text}
                          className="select-text whitespace-pre-wrap"
                        />
                      )}
                    </div>
                    {message.role === "assistant" ? (
                      <>
                        <div className="mt-1.5 px-1 text-2xs leading-relaxed text-text-muted">
                          {message.used && message.used.length > 0
                            ? formatJamiAssistantUsedContext(message.used)
                            : "Used: General knowledge"}
                        </div>
                        {index === messages.length - 1 &&
                        !loading &&
                        message.followUps?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
                            {message.followUps.map((followUp) => (
                              <button
                                key={`${followUp.label}:${followUp.prompt}`}
                                type="button"
                                className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-2xs font-medium text-text-muted transition duration-fast hover:border-border-strong hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                                onClick={() => void sendMessage(followUp.prompt)}
                              >
                                {followUp.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
              {/*
                Only shown until the first words arrive. These models think
                before they write, so there is a silent gap that streaming
                cannot fill, and once text is streaming the dots would be
                competing with it.
              */}
              {loading && !answerHasStarted ? (
                <div className="flex justify-start">
                  <div className="app-chip rounded-xl rounded-bl-md px-4 py-3 text-sm text-text-muted" role="status">
                    <span className="inline-flex items-center gap-2">
                      <span key={waitingLabel} className="ai-waiting-label inline-block">
                        {waitingLabel}
                      </span>
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
          {historyOpen ? (
            <div className="text-center text-2xs text-text-muted">
              Saved chats keep their messages, not source files or notebook snapshots.
            </div>
          ) : viewingForeignThread ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/20 bg-accent/8 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text-primary">
                  This chat belongs to another study context
                </p>
                <p className="mt-1 text-2xs leading-relaxed text-text-muted">
                  You can read it here. Start a new chat to ask about {historyContextLabel}.
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full bg-accent px-3.5 py-2 text-xs font-semibold text-white transition duration-fast hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                onClick={startNewChat}
              >
                New chat
              </button>
            </div>
          ) : (
            <>
          {error ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-error/35 bg-error-muted px-3.5 py-3 text-xs text-[var(--color-error-text)]" role="alert">
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
          {historyNotice ? (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-warning/30 bg-warning-muted px-3.5 py-3 text-xs text-text-secondary" role="status">
              <span className="leading-relaxed">{historyNotice}</span>
              <button
                type="button"
                className="shrink-0 font-semibold underline decoration-current/40 underline-offset-2"
                onClick={() => setHistoryNotice(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <div className="relative rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-panel)] shadow-e1 transition duration-fast focus-within:border-accent/55 focus-within:ring-2 focus-within:ring-accent/15">
            <label htmlFor="jami-assistant-message" className="sr-only">
              Message Jami
            </label>
            <textarea
              ref={inputRef}
              id="jami-assistant-message"
              data-notebook-text-editor="true"
              rows={2}
              value={input}
              disabled={loading}
              placeholder="Ask Jami..."
              className="min-h-[3.5rem] w-full resize-none bg-transparent py-3 pl-4 pr-14 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none focus-visible:shadow-none disabled:cursor-not-allowed disabled:saturate-[0.82]"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <button
              type="button"
              aria-label="Send message to Jami"
              disabled={loading || !input.trim()}
              className="absolute bottom-2 right-2 inline-grid h-9 w-9 place-items-center rounded-full bg-accent text-white shadow-accent transition duration-fast hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:bg-[var(--color-glass-medium)] disabled:text-text-muted disabled:shadow-none"
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
              <div className="mt-2 flex w-full items-center justify-between gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-text-primary">
                    Use related Jami material
                  </span>
                  <span className="mt-0.5 block text-2xs leading-relaxed text-text-muted">
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
            <div className="px-1.5 pt-1 text-2xs text-text-muted">
              Jami can make mistakes. Check important answers.
            </div>
          </div>
            </>
          )}
        </footer>
      </DialogPanel>
    </Dialog>
  );
}
