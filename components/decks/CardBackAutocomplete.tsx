"use client";

import { useId, useState } from "react";
import {
  autocompleteCardBack,
  type CardBackAutocompleteStyle,
} from "@/services/ai/autocomplete-card";
import { Button } from "@/components/ui";

type Props = {
  front: string;
  currentBack?: string;
  deckId?: string;
  deckName?: string;
  tags?: string[];
  disabled?: boolean;
  onApply: (back: string) => void;
};

const STYLE_OPTIONS: { value: CardBackAutocompleteStyle; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "definition", label: "Definition" },
  { value: "equation", label: "Equation" },
  { value: "explanation", label: "Explain" },
  { value: "steps", label: "Steps" },
  { value: "example", label: "Example" },
  { value: "compare", label: "Compare" },
];

export default function CardBackAutocomplete({
  front,
  currentBack = "",
  deckId,
  deckName,
  tags = [],
  disabled = false,
  onApply,
}: Props) {
  const selectId = useId();
  const [style, setStyle] = useState<CardBackAutocompleteStyle>("auto");
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
        tags,
        style,
      });
      onApply(back);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to draft an answer.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-[1.4rem] border border-accent/18 bg-accent/[0.055] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">AI answer draft</div>
          <div className="mt-0.5 text-xs leading-5 text-text-muted">
            Pick the answer shape, then let Gemini draft the back.
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor={selectId}>
            Answer draft style
          </label>
          <select
            id={selectId}
            value={style}
            onChange={(event) => setStyle(event.target.value as CardBackAutocompleteStyle)}
            disabled={disabled || loading}
            className="min-h-[2.5rem] rounded-[1.4rem] border border-white/[0.14] bg-surface-panel-strong px-3 text-sm font-medium text-white outline-none transition duration-fast focus:border-warm-accent focus:ring-4 focus:ring-accent/18 disabled:opacity-50"
          >
            {STYLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canDraft}
            onClick={() => void handleDraft()}
          >
            {loading ? "Drafting..." : "AI draft back"}
          </Button>
        </div>
      </div>
      {error ? (
        <div className="mt-2 text-xs font-medium text-rose-200" role="alert">
          {error}
        </div>
      ) : null}
      {!front.trim() ? (
        <div className="mt-2 text-xs text-text-muted">
          Add the front of the card first so the AI has something to answer.
        </div>
      ) : null}
    </div>
  );
}
