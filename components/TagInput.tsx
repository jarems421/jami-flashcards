"use client";

import { useState } from "react";
import {
  addCardTag,
  getTagSuggestions,
  removeCardTag,
} from "@/lib/cards";

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
    <div className="space-y-2">
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent"
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
                x
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
          className="w-full rounded-md border border-border bg-glass-medium px-3 py-2 text-sm text-white placeholder:text-text-muted outline-none transition duration-fast focus:border-accent"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={commitPendingTag}
          className="rounded-md bg-glass-medium px-3 py-2 text-sm transition duration-fast hover:bg-glass-strong disabled:opacity-50"
        >
          Add tag
        </button>
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
              className="rounded-full border border-border bg-glass-medium px-3 py-1 text-xs text-text-muted transition duration-fast hover:bg-glass-strong disabled:opacity-50"
            >
              Use #{tag}
            </button>
          ))}
        </div>
      ) : null}

      {localError ? <p className="text-xs text-red-300">{localError}</p> : null}
    </div>
  );
}