"use client";

import { useState } from "react";
import {
  addCardTag,
  getTagSuggestions,
  removeCardTag,
} from "@/lib/study/cards";
import { Button } from "@/components/ui";

type TagInputProps = {
  tags: string[];
  pendingTag: string;
  availableTags: string[];
  onTagsChange: (tags: string[]) => void;
  onPendingTagChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  helperText?: string;
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
}: TagInputProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const suggestions = getTagSuggestions(availableTags, pendingTag, tags);

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
              className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"
            >
              <span>#{tag}</span>
              <button
                type="button"
                onClick={() => {
                  onTagsChange(removeCardTag(tags, tag));
                  setLocalError(null);
                }}
                disabled={disabled}
                aria-label={`Remove tag ${tag}`}
                className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white transition duration-fast hover:bg-white/20 disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex gap-2">
        <input
          value={pendingTag}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => {
            onPendingTagChange(event.target.value);
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
          className="w-full rounded-[2rem] border-[1.5px] border-white/[0.14] bg-surface-panel-strong px-5 py-[1rem] text-sm text-white placeholder:text-text-muted shadow-[0_14px_28px_rgba(8,2,24,0.28)] outline-none transition duration-fast hover:border-white/[0.20] focus:border-warm-accent focus:ring-4 focus:ring-accent/18"
        />
        <Button
          type="button"
          disabled={disabled}
          onClick={commitPendingTag}
          variant="secondary"
        >
          Add tag
        </Button>
      </div>

      {helperText ? (
        <p className="text-xs text-text-muted">{helperText}</p>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => handleSuggestionClick(tag)}
              disabled={disabled}
              className="rounded-full border border-border bg-white/[0.05] px-3 py-1.5 text-xs text-text-muted transition duration-fast hover:border-border-strong hover:bg-white/[0.08] disabled:opacity-50"
            >
              Use #{tag}
            </button>
          ))}
        </div>
      ) : null}

      {localError ? <p className="text-xs text-rose-200">{localError}</p> : null}
    </div>
  );
}
