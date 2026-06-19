"use client";

import { useState } from "react";
import { autocompleteCardBack } from "@/services/ai/autocomplete-card";
import { Button } from "@/components/ui";

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

  return (
    <div className="app-subtle-panel rounded-[1.4rem] p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">Draft the answer with AI</div>
          <div className="mt-0.5 text-xs leading-5 text-text-muted">
            Jami can draft a concise back for this card. You can still edit it before saving.
          </div>
        </div>
        <div className="flex sm:items-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canDraft}
            onClick={() => void handleDraft()}
          >
            {loading ? "Drafting..." : "Draft answer"}
          </Button>
        </div>
      </div>
      {error ? (
        <div className="app-danger mt-2 rounded-[1rem] px-3 py-2 text-xs font-medium" role="alert">
          {error}
        </div>
      ) : null}
      {!front.trim() ? (
        <div className="mt-2 text-xs text-text-muted">
          Add the front of the card first, then AI can help write the answer.
        </div>
      ) : null}
    </div>
  );
}
