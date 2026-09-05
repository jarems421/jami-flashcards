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

/**
 * What the chip says, which is the level itself.
 *
 * Deliberately not the option names used in the menu below and in Account
 * ("Quick", "Balanced", "Thorough"). Those describe the trade to somebody
 * choosing; this reports the setting to somebody who already chose, in the one
 * word they would use to ask what it is on.
 */
const REASONING_LEVEL_WORD: Record<ReasoningEffortPreference, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

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
        {/*
          The level, and nothing else.

          This carried an icon and a chevron either side of the word, which is
          three marks to say one thing on a chip eight pixels tall. The word is
          already the whole message, and it changes when the level changes, so
          it says both what this is and that it can be pressed.
        */}
        <span>{loading ? "Reasoning" : REASONING_LEVEL_WORD[effort]}</span>
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
