"use client";

import { useId, useRef, useState } from "react";
import CardFaceImage from "@/components/cards/CardFaceImage";
import { Button } from "@/components/ui";
import {
  CARD_IMAGE_ACCEPT,
  getCardImageFileError,
  type CardImageDraft,
} from "@/lib/study/card-images";
import { releaseCardImageDraft } from "@/services/study/card-images";

type CardImageFieldProps = {
  /** "Front image" or "Back image". */
  label: string;
  value?: CardImageDraft;
  onChange: (next: CardImageDraft | undefined) => void;
  disabled?: boolean;
};

/**
 * Adds, replaces or removes the image on one side of a card.
 *
 * Choosing a file only stages it: the preview is local and nothing reaches
 * Storage until the card is saved, so a student can try an image and change
 * their mind without leaving a file behind.
 */
export default function CardImageField({
  label,
  value,
  onChange,
  disabled = false,
}: CardImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  const lowerLabel = label.toLowerCase();

  const choose = (file: File | undefined) => {
    if (!file) return;
    const problem = getCardImageFileError(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    releaseCardImageDraft(value);
    onChange({ kind: "new", file, previewUrl: URL.createObjectURL(file) });
  };

  const remove = () => {
    releaseCardImageDraft(value);
    setError(null);
    onChange(undefined);
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={CARD_IMAGE_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          choose(event.target.files?.[0]);
          // Choosing the same file again after removing it should still work.
          event.target.value = "";
        }}
      />
      {value ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-2">
          <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-[var(--color-surface-panel)]">
            <CardFaceImage source={value} alt={label} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary">{label}</p>
            <p className="text-xs text-text-muted">
              {value.kind === "new" ? "Uploads when you save" : "On this card"}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`Replace ${lowerLabel}`}
              onClick={() => inputRef.current?.click()}
            >
              Replace
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`Remove ${lowerLabel}`}
              onClick={remove}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-describedby={error ? errorId : undefined}
          onClick={() => inputRef.current?.click()}
          className="flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--color-border-strong)] px-3 py-2 text-sm font-medium text-text-secondary transition duration-fast hover:border-accent/50 hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <rect x="3" y="4" width="14" height="12" rx="2" />
            <circle cx="7.5" cy="8.5" r="1.3" />
            <path d="m4 14 4-4 3 3 2-2 3 3" />
          </svg>
          Add {lowerLabel}
        </button>
      )}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
