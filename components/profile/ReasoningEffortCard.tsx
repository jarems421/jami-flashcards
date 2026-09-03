"use client";

import { useEffect, useRef, useState } from "react";
import { Card, FeedbackBanner, SectionHeader } from "@/components/ui";
import {
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffortPreference,
} from "@/lib/profile/reasoning-effort";
import { loadReasoningEffort, saveReasoningEffort } from "@/services/profile";

type ReasoningEffortCardProps = {
  userId: string;
};

/**
 * How long Jami is allowed to think before answering.
 *
 * Said in waiting rather than in tokens, because waiting is what a student
 * actually spends. The measured difference on the worker model is 4.4 seconds
 * against 12.4 for the same question, so this is a real choice and not a
 * placebo dial.
 *
 * Saved on choosing, like the study level beside it. A preference that needs a
 * second click on a button is a preference that quietly never gets set.
 */
export default function ReasoningEffortCard({ userId }: ReasoningEffortCardProps) {
  const [effort, setEffort] = useState<ReasoningEffortPreference | "">("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | undefined
  >();
  const latestRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const current = (await loadReasoningEffort(userId)) ?? "";
        if (!cancelled) setEffort(current);
      } catch (error) {
        console.error("Failed to load the reasoning effort preference.", error);
        if (!cancelled) {
          setFeedback({
            type: "error",
            message: "Jami could not load your thinking-time setting.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const choose = async (next: ReasoningEffortPreference) => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setEffort(next);
    setFeedback(undefined);
    setSaving(true);
    try {
      const saved = (await saveReasoningEffort(userId, next)) ?? "";
      if (latestRequestRef.current !== requestId) return;
      setEffort(saved);
      setFeedback({ type: "success", message: "Thinking time saved." });
    } catch (error) {
      console.error("Failed to save the reasoning effort preference.", error);
      if (latestRequestRef.current !== requestId) return;
      setFeedback({
        type: "error",
        message: "Jami could not save your thinking-time setting.",
      });
    } finally {
      if (latestRequestRef.current === requestId) setSaving(false);
    }
  };

  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Learning preferences"
        title="How long Jami thinks before answering"
        description="Harder questions always get more thinking than easy ones. This sets the floor."
      />

      <div
        role="radiogroup"
        aria-label="Thinking time"
        className="mt-5 grid gap-2 sm:grid-cols-3"
      >
        {REASONING_EFFORT_OPTIONS.map((option) => {
          const active = effort === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={loading || saving}
              onClick={() => void choose(option.value)}
              className={`rounded-lg border p-3 text-left transition duration-fast disabled:opacity-60 ${
                active
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                  : "border-[var(--color-border)] hover:border-border-strong hover:bg-[var(--color-glass-subtle)]"
              }`}
            >
              <span className="block text-sm font-semibold text-text-primary">
                {option.label}
              </span>
              <span className="mt-1 block text-2xs leading-5 text-text-muted">
                {option.description}
              </span>
              <span className="mt-2 block text-2xs font-medium text-text-secondary">
                {option.timing}
              </span>
            </button>
          );
        })}
      </div>

      {feedback ? (
        <div className="mt-4">
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onDismiss={() => setFeedback(undefined)}
          />
        </div>
      ) : null}
    </Card>
  );
}
