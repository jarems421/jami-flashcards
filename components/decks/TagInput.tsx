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
              className="app-selected inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium"
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
                className="shrink-0 rounded-full bg-glass-medium px-1.5 py-0.5 text-[10px] text-text-primary transition duration-fast hover:bg-glass-strong disabled:cursor-not-allowed disabled:saturate-[0.82]"
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
          className="app-field w-full rounded-[1.6rem] px-5 py-[1rem] text-sm outline-none transition duration-fast"
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
          <div className="app-subtle-panel flex max-h-52 flex-wrap gap-2 overflow-y-auto rounded-[1.1rem] p-2">
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleSuggestionClick(tag)}
                disabled={disabled}
                className="app-chip max-w-full rounded-full px-3 py-1.5 text-left text-xs transition duration-fast hover:border-border-strong disabled:cursor-not-allowed disabled:saturate-[0.82] sm:max-w-[16rem]"
              >
                <span className="block truncate">
                  Suggested {suggestionLabel}: {tag}
                </span>
                <span className="mt-1 block font-semibold text-text-primary">Use {suggestionLabel}</span>
              </button>
            ))}
          </div>
          {hasHiddenSuggestions || showAllSuggestions ? (
            <button
              type="button"
              onClick={() => setShowAllSuggestions((value) => !value)}
              disabled={disabled}
              aria-expanded={showAllSuggestions}
              className="text-xs font-medium text-text-muted transition duration-fast hover:text-text-primary disabled:cursor-not-allowed disabled:saturate-[0.82]"
            >
              {showAllSuggestions
                ? "Show fewer tags"
                : `Show ${hiddenSuggestionCount} more tag${hiddenSuggestionCount === 1 ? "" : "s"}`}
            </button>
          ) : null}
        </div>
      ) : null}

      {localError ? <p className="text-xs text-[var(--color-error-text)]">{localError}</p> : null}
    </div>
  );
}
