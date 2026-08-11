"use client";

import { useId, useRef } from "react";

/**
 * Choosing a file, and being able to see which one was chosen.
 *
 * A bare `<input type="file">` is the one control the browser will not let you
 * style, and it shows "No file chosen" in a system font next to a system button
 * -- so a form that looks designed everywhere else falls apart at exactly the
 * step where somebody is handing over the paper they want marked.
 *
 * The input is still the input; it is only moved out of sight and driven by a
 * button, so keyboard focus, file dialogs, and form semantics are unchanged.
 * What is gained is that the chosen file is named back to the reader, which the
 * native control does only in a truncated tooltip.
 */
export default function FileField({
  label,
  hint,
  accept,
  file,
  disabled = false,
  onChange,
  className = "",
}: {
  label: string;
  hint?: string;
  accept?: string;
  file: File | null;
  disabled?: boolean;
  onChange: (file: File | null) => void;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`rounded-2xl border p-4 transition duration-fast ${
        file
          ? "border-accent/45 bg-accent/8"
          : "border-[var(--color-border)] bg-[var(--color-surface-panel)]"
      } ${className}`}
    >
      <label htmlFor={inputId} className="block text-sm font-semibold text-text-primary">
        {label}
      </label>
      {hint ? (
        <p className="mt-1 text-xs leading-5 text-text-muted">{hint}</p>
      ) : null}

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="app-field min-h-9 rounded-xl px-3.5 text-xs font-semibold text-text-primary transition duration-fast hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {file ? "Choose a different file" : "Choose file"}
        </button>
        {file ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              // Clearing the element too, or picking the same file again after
              // a remove would fire no change event at all.
              if (inputRef.current) inputRef.current.value = "";
              onChange(null);
            }}
            className="min-h-9 rounded-xl px-2.5 text-xs font-medium text-text-muted transition duration-fast hover:text-text-primary"
          >
            Remove
          </button>
        ) : null}
      </div>

      <p
        className={`mt-2.5 truncate text-xs ${
          file ? "font-medium text-text-secondary" : "text-text-muted"
        }`}
        title={file?.name}
      >
        {file ? file.name : "Nothing chosen yet"}
      </p>
    </div>
  );
}
