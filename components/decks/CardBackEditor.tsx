"use client";

import { useId, type ReactNode } from "react";

type CardBackEditorProps = {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  rows?: number;
  disabled?: boolean;
  /**
   * Optional control shown on the label row, opposite the label. Actions that
   * belong to this field live here rather than beneath it, so they cost no
   * vertical space and never sit between the field and whatever follows it.
   */
  action?: ReactNode;
};

export default function CardBackEditor({
  label = "Back",
  placeholder = "Answer",
  value,
  onChange,
  maxLength,
  rows = 6,
  disabled = false,
  action,
}: CardBackEditorProps) {
  const textareaId = useId();

  return (
    <div>
      {label || action ? (
        <div className="mb-2 flex min-h-[1.75rem] items-center justify-between gap-3">
          {label ? (
            <label
              htmlFor={textareaId}
              className="block text-sm font-medium tracking-[0.01em] text-text-secondary"
            >
              {label}
            </label>
          ) : (
            <span aria-hidden="true" />
          )}
          {action}
        </div>
      ) : null}
      <div className="app-field rounded-[1.5rem] transition duration-fast">
        <textarea
          id={textareaId}
          rows={rows}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          // Inherit the wrapper's radius so the field reads as one shape rather
          // than two rounded rectangles sitting on top of each other.
          className="w-full resize-y rounded-[inherit] bg-transparent px-5 py-4 text-sm leading-6 text-field-text placeholder:text-field-placeholder outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>
    </div>
  );
}
