"use client";

import { useState } from "react";
import { autocompleteCardBack } from "@/services/ai/autocomplete-card";
import { JamiTutorIcon } from "@/components/ui";

type Props = {
  front: string;
  currentBack?: string;
  deckId?: string;
  deckName?: string;
  topics?: string[];
  topicIds?: string[];
  disabled?: boolean;
  onApply: (back: string) => void;
};

export default function CardBackAutocomplete({
  front,
  currentBack = "",
  deckId,
  deckName,
  topics = [],
  topicIds = [],
  disabled = false,
  onApply,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDraft = !disabled && front.trim().length > 0 && !loading;

  const handleDraft = async () => {
    if (!canDraft) return;

    setLoading(true);
    setError(null);
    try {
      const back = await autocompleteCardBack({
        front,
        currentBack,
        deckId,
        deckName,
        topics,
        topicIds,
      });
      onApply(back);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "AI could not finish the draft just now. Keep typing, or draft again in a moment."
      );
    } finally {
      setLoading(false);
    }
  };

  /*
   * A single control rather than a titled panel. What it does is evident from
   * the sparkle, the word, and the field it sits on, and it lives on the Back
   * label row so it costs no vertical space and never separates the field from
   * what comes after it.
   *
   * Both reasons it can be unavailable are explained on hover rather than in
   * standing body text: no front yet, or a failed attempt.
   */
  const hint = !front.trim()
    ? "Write the front first, then Jami can draft the answer."
    : "Draft this answer with Jami. You can edit it before saving.";

  return (
    <div className="flex min-w-0 items-center justify-end gap-2">
      {error ? (
        <span
          role="alert"
          className="min-w-0 truncate text-xs font-medium text-[var(--color-error-text)]"
          title={error}
        >
          {error}
        </span>
      ) : null}
      <button
        type="button"
        disabled={!canDraft}
        onClick={() => void handleDraft()}
        title={error ?? hint}
        aria-label={hint}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-text-muted transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-text-muted"
      >
        <JamiTutorIcon className="h-3.5 w-3.5" />
        {loading ? "Drafting…" : "Draft"}
      </button>
    </div>
  );
}
