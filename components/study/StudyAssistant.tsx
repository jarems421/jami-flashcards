"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  sendChatMessage,
  type ChatMessage,
  type StudyChatContext,
  type StudyChatIntent,
} from "@/services/ai/chat";
import type { Card } from "@/lib/study/cards";

type Props = {
  card: Card;
  autoExplain: boolean;
  onContinue: () => void;
  mode?: "clue" | "review";
  deckName?: string;
};

function ThinkingIndicator({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 text-sm text-text-muted ${
        compact ? "" : "py-1"
      }`}
      aria-live="polite"
      aria-label="AI is thinking"
    >
      <span>Thinking</span>
      <span className="ai-thinking-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

function getQuickActions(mode: "clue" | "review") {
  return mode === "clue"
    ? [
        { label: "Gentle clue", intent: "clue" as const, prompt: "Give me a gentle clue without revealing the answer." },
        { label: "Stronger clue", intent: "strong-clue" as const, prompt: "Give me a stronger clue, but do not say the answer directly." },
        { label: "Quiz me", intent: "self-test" as const, prompt: "Quiz me briefly so I can work it out myself." },
      ]
    : [
        { label: "Explain simply", intent: "explain-simple" as const, prompt: "Explain this simply." },
        { label: "What am I mixing up?", intent: "why-wrong" as const, prompt: "What am I mixing up here, and what key difference should I remember?" },
        { label: "Test me again", intent: "self-test" as const, prompt: "Test me again on this concept without just handing me the answer." },
      ];
}

export default function StudyAssistant({
  card,
  autoExplain,
  onContinue,
  mode = "review",
  deckName,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(autoExplain);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatHistoryRef = useRef<ChatMessage[]>([]);
  const isClueMode = mode === "clue";
  const studyContext: StudyChatContext = {
    mode,
    front: card.front,
    back: card.back,
    deckId: card.deckId,
    deckName,
    tags: card.tags,
    difficulty: card.difficulty,
    lapses: card.lapses,
    reps: card.reps,
    scheduledDays: card.scheduledDays,
    elapsedDays: card.elapsedDays,
  };
  const quickActions = getQuickActions(mode);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Reset state when card changes
  useEffect(() => {
    setMessages([]);
    setInput("");
    setLoading(false);
    chatHistoryRef.current = [];
    if (!autoExplain) setOpen(false);
  }, [card.id, autoExplain]);

  // After a struggle, ask what happened first instead of guessing the mistake.
  useEffect(() => {
    if (!autoExplain) return;

    const msg: ChatMessage = {
      role: "model",
      text:
        "What went wrong there? Tell me what happened, like what you mixed up, forgot, or nearly got right, and I'll help from that.",
    };

    setMessages([msg]);
    chatHistoryRef.current = [msg];
    setLoading(false);
  }, [
    autoExplain,
    card.id,
  ]);

  const runPrompt = async (text: string, intent: StudyChatIntent) => {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = { role: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    chatHistoryRef.current = [...chatHistoryRef.current, userMsg];
    setInput("");
    setLoading(true);

    try {
      const reply = await sendChatMessage(
        text,
        chatHistoryRef.current.slice(0, -1),
        studyContext,
        intent
      );
      const modelMsg: ChatMessage = { role: "model", text: reply };
      setMessages((prev) => [...prev, modelMsg]);
      chatHistoryRef.current = [...chatHistoryRef.current, modelMsg];
    } catch (err) {
      const errText = err instanceof Error
        ? err.message
        : "AI is taking longer than usual. Keep studying, or ask again in a moment.";
      const errMsg: ChatMessage = {
        role: "model",
        text: errText,
      };
      setMessages((prev) => [...prev, errMsg]);
      chatHistoryRef.current = [...chatHistoryRef.current, errMsg];
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    await runPrompt(text, isClueMode ? "clue" : autoExplain ? "why-wrong" : "follow-up");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full min-h-[3rem] items-center justify-center gap-2 rounded-[1.75rem] border border-accent/20 bg-accent/[0.06] px-4 py-2.5 text-sm font-medium text-accent transition duration-fast hover:bg-accent/[0.12] active:scale-[0.98]"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
        {isClueMode ? "Need a clue? Ask AI" : "Need help? Ask AI"}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[1.75rem] border border-accent/20 bg-accent/[0.06] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-accent">
            {isClueMode ? "Jami clue mode" : "Jami AI"}
          </p>
          {!autoExplain ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setMessages([]);
                setInput("");
                chatHistoryRef.current = [];
              }}
              className="text-xs text-text-muted hover:text-white transition"
            >
              Close
            </button>
          ) : null}
        </div>

        <div
          ref={scrollRef}
          className="max-h-[16rem] space-y-2.5 overflow-y-auto"
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-accent/20 text-white"
                    : "bg-white/[0.06] text-text-secondary"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {loading && messages.length === 0 ? (
            <ThinkingIndicator />
          ) : loading ? (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-white/[0.06] px-3.5 py-2.5 text-sm text-text-muted">
                <ThinkingIndicator compact />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isClueMode
                ? "Ask for a clue without revealing the answer"
                : autoExplain
                  ? "Tell me what went wrong..."
                : "Ask for a follow-up or explanation"
            }
            disabled={loading}
            className="flex-1 rounded-xl border border-white/[0.14] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-text-muted outline-none transition focus:border-accent/50 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={loading || !input.trim()}
            onClick={() => void handleSend()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:brightness-110 active:scale-95 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
              <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
            </svg>
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={loading}
              onClick={() => void runPrompt(action.prompt, action.intent)}
              className="rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-2 text-xs font-medium text-text-secondary transition duration-fast hover:border-accent/30 hover:bg-accent/[0.08] hover:text-white disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {autoExplain ? (
        <button
          type="button"
          disabled={loading && messages.length === 0}
          className="flex w-full min-h-[3.5rem] items-center justify-center rounded-[1.75rem] border border-border bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white shadow-card transition duration-fast ease-spring hover:border-border-strong hover:bg-white/[0.10] active:scale-[0.98] disabled:opacity-50"
          onClick={onContinue}
        >
          Continue
        </button>
      ) : null}
    </div>
  );
}
