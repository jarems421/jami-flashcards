"use client";

import { useEffect, useRef, useState } from "react";
import {
  getReasoningEffortLabel,
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffortPreference,
} from "@/lib/profile/reasoning-effort";
import { loadReasoningEffort, saveReasoningEffort } from "@/services/profile";

type TutorReasoningMenuProps = {
  userId: string;
  disabled?: boolean;
  onSaveStarted: (save: Promise<void>) => void;
  onError: (message: string) => void;
};

function ThinkingIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
      <path
        d="M3 8h.01M8 8h.01M13 8h.01"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function TutorReasoningMenu({
  userId,
  disabled = false,
  onSaveStarted,
  onError,
}: TutorReasoningMenuProps) {
  const [effort, setEffort] = useState<ReasoningEffortPreference>("medium");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestChoiceRef = useRef(0);
  const lastSavedRef = useRef<ReasoningEffortPreference>("medium");

  useEffect(() => {
    let cancelled = false;
    void loadReasoningEffort(userId)
      .then((saved) => {
        if (cancelled) return;
        const next = saved ?? "medium";
        lastSavedRef.current = next;
        setEffort(next);
      })
      .catch(() => {
        if (!cancelled) onError("Jami could not load your thinking setting.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onError, userId]);

  const choose = (next: ReasoningEffortPreference) => {
    const choiceId = latestChoiceRef.current + 1;
    latestChoiceRef.current = choiceId;
    setEffort(next);
    setSaving(true);
    detailsRef.current?.removeAttribute("open");

    const save = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = (await saveReasoningEffort(userId, next)) ?? "medium";
        lastSavedRef.current = saved;
        if (latestChoiceRef.current === choiceId) setEffort(saved);
      })
      .catch(() => {
        if (latestChoiceRef.current === choiceId) {
          setEffort(lastSavedRef.current);
          onError("Jami could not save your thinking setting.");
        }
      })
      .finally(() => {
        if (latestChoiceRef.current === choiceId) setSaving(false);
      });

    saveQueueRef.current = save;
    onSaveStarted(save);
  };

  return (
    <details ref={detailsRef} className="group relative">
      <summary
        aria-label={`Reasoning: ${getReasoningEffortLabel(effort)}`}
        title="Choose reasoning level"
        className="app-chip flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-text-secondary transition duration-fast hover:border-[var(--color-border-strong)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 [&::-webkit-details-marker]:hidden"
      >
        <ThinkingIcon />
        <span>{loading ? "Reasoning" : getReasoningEffortLabel(effort)}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className="h-3 w-3 transition-transform duration-fast group-open:rotate-180"
        >
          <path d="m4 9 4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>

      <div className="absolute bottom-10 left-0 z-30 w-64 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1.5 shadow-e3">
        <div className="px-2.5 pb-1.5 pt-1 text-2xs font-semibold uppercase tracking-[0.14em] text-text-muted">
          Reasoning
        </div>
        {REASONING_EFFORT_OPTIONS.map((option) => {
          const active = effort === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled || loading || saving}
              onClick={() => choose(option.value)}
              className={`flex w-full items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition duration-fast disabled:cursor-not-allowed disabled:opacity-60 ${
                active
                  ? "bg-[var(--color-accent-muted)]"
                  : "hover:bg-[var(--color-glass-subtle)]"
              }`}
            >
              <span>
                <span className="block text-sm font-medium text-text-primary">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-2xs leading-4 text-text-muted">
                  {option.description}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  active ? "bg-accent" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
    </details>
  );
}
