"use client";

import { useId, useState, type ReactNode } from "react";
import { Button, Input, StudyText } from "@/components/ui";

type AnswerListFieldProps = {
  label: string;
  /** A line under the label saying what the list is for. */
  description?: ReactNode;
  values: readonly string[];
  onChange: (values: string[]) => void;
  /** No more than this many can be added. */
  max: number;
  maxLength: number;
  placeholder?: string;
  disabled?: boolean;
  /** What Learn will make of the list, under it. */
  status?: ReactNode;
};

/**
 * A short list of answers, one added at a time: other ways to say the answer,
 * wrong answers for multiple choice, words to blank.
 *
 * Each sits in its own removable chip, written the way a card renders it, so
 * an answer with maths in it reads as it will in Learn. Enter adds, as it does
 * in every one-line field; a repeat, in any case, is not added twice.
 */
export default function AnswerListField({
  label,
  description,
  values,
  onChange,
  max,
  maxLength,
  placeholder,
  disabled = false,
  status,
}: AnswerListFieldProps) {
  const inputId = useId();
  const [text, setText] = useState("");
  const entry = text.trim();
  const repeated = values.some((value) => value.toLocaleLowerCase() === entry.toLocaleLowerCase());
  const full = values.length >= max;

  const add = () => {
    if (!entry || repeated || full || disabled) return;
    onChange([...values, entry]);
    setText("");
  };

  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="block text-sm font-medium tracking-[0.01em] text-text-secondary">
        {label}
      </label>
      {description ? <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p> : null}
      {values.length > 0 ? (
        <ul aria-label={label} className="mt-2.5 flex flex-wrap gap-2">
          {values.map((value) => (
            <li
              key={value}
              className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-medium)] py-1 pl-3 pr-1 text-sm text-text-primary"
            >
              <StudyText text={value} className="min-w-0 truncate" />
              <button
                type="button"
                aria-label={`Remove ${value}`}
                disabled={disabled}
                onClick={() => onChange(values.filter((candidate) => candidate !== value))}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-strong)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                  <path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {full ? (
        <p className="mt-2 text-xs text-text-muted">That&apos;s the most Learn uses ({max}).</p>
      ) : (
        <div className="mt-2.5 flex items-start gap-2">
          <Input
            id={inputId}
            symbols
            value={text}
            placeholder={placeholder}
            maxLength={maxLength}
            disabled={disabled}
            containerClassName="min-w-0 flex-1"
            className="!py-3"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // A one-line field's Enter means "this one is done", never "save the card".
              event.preventDefault();
              event.stopPropagation();
              add();
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || !entry || repeated}
            onClick={add}
            className="min-h-[3rem] shrink-0"
          >
            Add
          </Button>
        </div>
      )}
      {repeated && entry ? <p className="mt-1.5 text-xs text-text-muted">Already in the list.</p> : null}
      {status ? <div className="mt-2">{status}</div> : null}
    </div>
  );
}
