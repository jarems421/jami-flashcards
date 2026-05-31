"use client";

import { useId } from "react";

type CardBackEditorProps = {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  rows?: number;
  disabled?: boolean;
};

export default function CardBackEditor({
  label = "Back",
  placeholder = "Answer",
  value,
  onChange,
  maxLength,
  rows = 6,
  disabled = false,
}: CardBackEditorProps) {
  const textareaId = useId();

  return (
    <div>
      {label ? (
        <label
          htmlFor={textareaId}
          className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
        >
          {label}
        </label>
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
          className="w-full resize-y rounded-[1.5rem] bg-transparent px-5 py-4 text-sm leading-6 text-field-text placeholder:text-field-placeholder outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>
    </div>
  );
}
