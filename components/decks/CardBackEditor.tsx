"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

type FormatMode = "plain" | "bullet" | "numbered" | "definition" | "formula" | "compare";

type CardBackEditorProps = {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  rows?: number;
  disabled?: boolean;
};

const FORMAT_ACTIONS: Array<{
  mode: FormatMode;
  label: string;
  starter: string;
  hint: string;
}> = [
  {
    mode: "plain",
    label: "Paragraph",
    starter: "",
    hint: "Normal answer text",
  },
  {
    mode: "bullet",
    label: "Bullets",
    starter: "- ",
    hint: "Enter creates the next bullet",
  },
  {
    mode: "numbered",
    label: "Numbered",
    starter: "1. ",
    hint: "Enter creates the next step",
  },
  {
    mode: "definition",
    label: "Definition",
    starter: "Definition: ",
    hint: "Then add short supporting points",
  },
  {
    mode: "formula",
    label: "Formula",
    starter: "Formula: ",
    hint: "Then add variables or notes",
  },
  {
    mode: "compare",
    label: "Compare",
    starter: "A: ",
    hint: "Then B and the key difference",
  },
];

function getLineInfo(value: string, cursor: number) {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const lineStart = value.lastIndexOf("\n", safeCursor - 1) + 1;
  const lineEndIndex = value.indexOf("\n", safeCursor);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

  return {
    lineStart,
    lineEnd,
    line: value.slice(lineStart, lineEnd),
    lineBeforeCursor: value.slice(lineStart, safeCursor),
  };
}

function replaceRange(value: string, start: number, end: number, replacement: string) {
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`;
}

function getNextNumber(value: string, cursor: number) {
  const { lineBeforeCursor } = getLineInfo(value, cursor);
  const currentNumber = lineBeforeCursor.match(/^\s*(\d+)\.\s/);

  if (currentNumber) {
    return Number(currentNumber[1]) + 1;
  }

  const beforeCursor = value.slice(0, cursor);
  const matches = [...beforeCursor.matchAll(/(?:^|\n)\s*(\d+)\.\s/g)];
  const lastMatch = matches.at(-1);

  return lastMatch ? Number(lastMatch[1]) + 1 : 1;
}

function isOnlyBulletMarker(lineBeforeCursor: string) {
  return /^\s*-\s*$/.test(lineBeforeCursor);
}

function isOnlyNumberMarker(lineBeforeCursor: string) {
  return /^\s*\d+\.\s*$/.test(lineBeforeCursor);
}

function isBulletLine(lineBeforeCursor: string) {
  return /^\s*-\s/.test(lineBeforeCursor);
}

function startsWithLabel(lineBeforeCursor: string, label: string) {
  return lineBeforeCursor.trimStart().startsWith(label);
}

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [formatMode, setFormatMode] = useState<FormatMode>("plain");

  const commitValue = (nextValue: string, cursor: number) => {
    const limitedValue =
      typeof maxLength === "number" ? nextValue.slice(0, maxLength) : nextValue;
    const nextCursor = Math.min(cursor, limitedValue.length);

    onChange(limitedValue);

    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const insertText = (text: string, nextMode = formatMode) => {
    if (disabled) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextValue = replaceRange(value, start, end, text);

    setFormatMode(nextMode);
    commitValue(nextValue, start + text.length);
  };

  const applyFormat = (nextMode: FormatMode, starterTemplate: string) => {
    if (disabled) return;

    setFormatMode(nextMode);

    if (nextMode === "plain") {
      textareaRef.current?.focus();
      return;
    }

    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const starter =
      nextMode === "numbered" ? `${getNextNumber(value, start)}. ` : starterTemplate;
    const { line, lineStart } = getLineInfo(value, start);
    const selectionHasText = start !== end;

    if (selectionHasText) {
      const selectedText = value.slice(start, end);
      const wrappedText =
        nextMode === "bullet"
          ? selectedText
              .split("\n")
              .map((lineText) => (lineText.trim() ? `- ${lineText}` : "- "))
              .join("\n")
          : nextMode === "numbered"
            ? selectedText
                .split("\n")
                .map((lineText, index) =>
                  lineText.trim() ? `${index + 1}. ${lineText}` : `${index + 1}. `
                )
                .join("\n")
            : `${starter}${selectedText}`;

      const nextValue = replaceRange(value, start, end, wrappedText);
      commitValue(nextValue, start + wrappedText.length);
      return;
    }

    if (!line.trim()) {
      const nextValue = replaceRange(value, lineStart, start, starter);
      commitValue(nextValue, lineStart + starter.length);
      return;
    }

    const separator = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    insertText(`${separator}${starter}`, nextMode);
  };

  const exitEmptyMarker = (lineStart: number, cursor: number) => {
    const nextValue = replaceRange(value, lineStart, cursor, "");
    setFormatMode("plain");
    commitValue(nextValue, lineStart);
  };

  const continueFormat = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || formatMode === "plain") {
      return;
    }

    const textarea = event.currentTarget;
    const cursor = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;

    if (cursor !== selectionEnd) {
      return;
    }

    const { lineStart, lineBeforeCursor } = getLineInfo(value, cursor);
    let insertion = "\n";

    if (formatMode === "bullet") {
      if (isOnlyBulletMarker(lineBeforeCursor)) {
        event.preventDefault();
        exitEmptyMarker(lineStart, cursor);
        return;
      }
      insertion = "\n- ";
    }

    if (formatMode === "numbered") {
      if (isOnlyNumberMarker(lineBeforeCursor)) {
        event.preventDefault();
        exitEmptyMarker(lineStart, cursor);
        return;
      }
      insertion = `\n${getNextNumber(value, cursor)}. `;
    }

    if (formatMode === "definition") {
      if (isOnlyBulletMarker(lineBeforeCursor)) {
        event.preventDefault();
        exitEmptyMarker(lineStart, cursor);
        return;
      }
      insertion = startsWithLabel(lineBeforeCursor, "Definition:") ? "\n- " : "\n- ";
    }

    if (formatMode === "formula") {
      if (isOnlyBulletMarker(lineBeforeCursor)) {
        event.preventDefault();
        exitEmptyMarker(lineStart, cursor);
        return;
      }
      if (startsWithLabel(lineBeforeCursor, "Formula:")) {
        insertion = "\nVariables:\n- ";
      } else if (startsWithLabel(lineBeforeCursor, "Variables:")) {
        insertion = "\n- ";
      } else {
        insertion = isBulletLine(lineBeforeCursor) ? "\n- " : "\nNote: ";
      }
    }

    if (formatMode === "compare") {
      if (isOnlyBulletMarker(lineBeforeCursor)) {
        event.preventDefault();
        exitEmptyMarker(lineStart, cursor);
        return;
      }
      if (startsWithLabel(lineBeforeCursor, "A:")) {
        insertion = "\nB: ";
      } else if (startsWithLabel(lineBeforeCursor, "B:")) {
        insertion = "\nKey difference: ";
      } else if (startsWithLabel(lineBeforeCursor, "Key difference:")) {
        insertion = "\n- ";
      } else {
        insertion = "\n- ";
      }
    }

    event.preventDefault();
    insertText(insertion);
  };

  return (
    <div className="space-y-3">
      <div>
        {label ? (
          <label
            htmlFor={textareaId}
            className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary"
          >
            {label}
          </label>
        ) : null}
        <textarea
          ref={textareaRef}
          id={textareaId}
          rows={rows}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={continueFormat}
          className="w-full rounded-[1.5rem] border-[1.5px] border-white/[0.14] bg-surface-panel-strong px-5 py-4 text-sm text-white placeholder:text-text-muted shadow-[0_14px_28px_rgba(8,2,24,0.28)] outline-none transition duration-fast hover:border-white/[0.20] focus:border-warm-accent focus:ring-4 focus:ring-accent/18 focus:shadow-[0_18px_36px_rgba(183,124,255,0.2)] disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <div className="rounded-[1.35rem] border border-white/[0.10] bg-white/[0.035] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            Answer shape
          </div>
          <div className="hidden text-xs text-text-muted sm:block">
            Press Return to continue the active format.
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
          {FORMAT_ACTIONS.map((action) => {
            const isActive = action.mode === formatMode;

            return (
              <button
                key={action.mode}
                type="button"
                disabled={disabled}
                title={action.hint}
                onClick={() => applyFormat(action.mode, action.starter)}
                className={`shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition duration-fast disabled:opacity-50 ${
                  isActive
                    ? "border-warm-accent/70 bg-warm-accent/18 text-white shadow-[0_8px_18px_rgba(255,196,135,0.16)]"
                    : "border-white/[0.12] bg-white/[0.055] text-text-secondary hover:border-white/[0.22] hover:bg-white/[0.08] hover:text-white"
                }`}
              >
                {action.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
