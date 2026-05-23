"use client";

import { useMemo, useState } from "react";
import {
  addCardTag,
  getTagSuggestions,
  removeCardTag,
} from "@/lib/study/cards";
import { Button } from "@/components/ui";

const COLLAPSED_SUGGESTION_LIMIT = 6;

type TagInputProps = {
  tags: string[];
  pendingTag: string;
  availableTags: string[];
  onTagsChange: (tags: string[]) => void;
  onPendingTagChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  helperText?: string;
  suggestionLabel?: string;
};

export default function TagInput({
  tags,
  pendingTag,
  availableTags,
  onTagsChange,
  onPendingTagChange,
  placeholder = "Type a tag and press Add",
  disabled = false,
  helperText,
  suggestionLabel = "tag",
}: TagInputProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const allSuggestions = useMemo(
    () => getTagSuggestions(availableTags, pendingTag, tags, availableTags.length),
    [availableTags, pendingTag, tags]
  );
  const suggestions = showAllSuggestions
    ? allSuggestions
    : allSuggestions.slice(0, COLLAPSED_SUGGESTION_LIMIT);
  const hiddenSuggestionCount = allSuggestions.length - suggestions.length;
  const hasHiddenSuggestions = hiddenSuggestionCount > 0;

  const commitPendingTag = () => {
    const result = addCardTag(tags, pendingTag);

    if (result.error) {
      setLocalError(result.error);
      return;
    }

    onTagsChange(result.nextTags);
    if (pendingTag.trim()) {
      onPendingTagChange("");
    }
    setLocalError(null);
  };

  const handleSuggestionClick = (tag: string) => {
    const result = addCardTag(tags, tag);
    if (result.error) {
      setLocalError(result.error);
      return;
    }

    onTagsChange(result.nextTags);
    onPendingTagChange("");
    setLocalError(null);
  };

  return (
    <div className="space-y-3">
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"
            >
              <span className="min-w-0 truncate">{tag}</span>
              <button
                type="button"
                onClick={() => {
                  onTagsChange(removeCardTag(tags, tag));
                  setLocalError(null);
                }}
                disabled={disabled}
                aria-label={`Remove tag ${tag}`}
                className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white transition duration-fast hover:bg-white/20 disabled:opacity-50"
              >
                x
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={pendingTag}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => {
            onPendingTagChange(event.target.value);
            setShowAllSuggestions(false);
            if (localError) {
              setLocalError(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "," || event.key === "Enter") {
              event.preventDefault();
              commitPendingTag();
              return;
            }

            if (event.key === "Backspace" && !pendingTag && tags.length > 0) {
              onTagsChange(tags.slice(0, -1));
              setLocalError(null);
            }
          }}
          className="w-full rounded-[1.6rem] border-[1.5px] border-white/[0.12] bg-surface-panel-strong px-5 py-[1rem] text-sm text-white placeholder:text-text-muted shadow-[0_10px_22px_rgba(8,2,24,0.18)] outline-none transition duration-fast hover:border-white/[0.18] focus:border-warm-accent/80 focus:ring-4 focus:ring-accent/14"
        />
        <Button
          type="button"
          disabled={disabled}
          onClick={commitPendingTag}
          variant="secondary"
          className="w-full sm:w-auto sm:shrink-0"
        >
          Add tag
        </Button>
      </div>

      {helperText ? (
        <p className="text-xs text-text-muted">{helperText}</p>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
            <span>
              Suggested {suggestionLabel}
              {allSuggestions.length === 1 ? "" : "s"}
            </span>
            <span>
              {suggestions.length} of {allSuggestions.length}
            </span>
          </div>
          <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto rounded-[1.1rem] border border-white/[0.08] bg-white/[0.025] p-2">
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleSuggestionClick(tag)}
                disabled={disabled}
                className="max-w-full rounded-full border border-border bg-white/[0.05] px-3 py-1.5 text-left text-xs text-text-muted transition duration-fast hover:border-border-strong hover:bg-white/[0.08] disabled:opacity-50 sm:max-w-[16rem]"
              >
                <span className="block truncate">
                  Suggested {suggestionLabel}: {tag}
                </span>
                <span className="mt-1 block font-semibold text-white">Use {suggestionLabel}</span>
              </button>
            ))}
          </div>
          {hasHiddenSuggestions || showAllSuggestions ? (
            <button
              type="button"
              onClick={() => setShowAllSuggestions((value) => !value)}
              disabled={disabled}
              aria-expanded={showAllSuggestions}
              className="text-xs font-medium text-text-muted transition duration-fast hover:text-white disabled:opacity-50"
            >
              {showAllSuggestions
                ? "Show fewer tags"
                : `Show ${hiddenSuggestionCount} more tag${hiddenSuggestionCount === 1 ? "" : "s"}`}
            </button>
          ) : null}
        </div>
      ) : null}

      {localError ? <p className="text-xs text-rose-200">{localError}</p> : null}
    </div>
  );
}
