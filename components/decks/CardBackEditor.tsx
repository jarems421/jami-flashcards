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
      <div className="rounded-[1.5rem] border-[1.5px] border-white/[0.12] bg-surface-panel-strong shadow-[0_12px_24px_rgba(8,2,24,0.22)] transition duration-fast focus-within:border-warm-accent/75 focus-within:ring-4 focus-within:ring-accent/14 hover:border-white/[0.18]">
        <textarea
          id={textareaId}
          rows={rows}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="w-full resize-y rounded-[1.5rem] bg-transparent px-5 py-4 text-sm leading-6 text-white placeholder:text-text-muted outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>
    </div>
  );
}
