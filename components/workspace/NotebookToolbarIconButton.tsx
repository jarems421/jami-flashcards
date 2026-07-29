"use client";

import type { ReactNode } from "react";
import { JamiSparklesIcon } from "@/components/ui";

export type NotebookIconName =
  | "back"
  | "pages"
  | "text"
  | "pen"
  | "highlighter"
  | "eraser"
  | "undo"
  | "redo"
  | "ai"
  | "chevron"
  | "options"
  | "trash"
  | "plus"
  | "check"
  | "alert"
  | "close";

// Hand-drawn on a consistent 24px grid with a uniform 1.8 stroke, rounded
// caps/joins, and shared optical margins, so the set reads as one family.
export function NotebookIcon({ name }: { name: NotebookIconName }) {
  if (name === "ai") {
    return <JamiSparklesIcon className="h-[1.125rem] w-[1.125rem]" />;
  }

  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[1.125rem] w-[1.125rem]"
    >
      {name === "back" ? (
        <path {...common} d="M14.5 17.5 9 12l5.5-5.5" />
      ) : null}
      {name === "pages" ? (
        <>
          <rect
            {...common}
            x="8"
            y="3.8"
            width="11.2"
            height="14.4"
            rx="2.2"
          />
          <path {...common} d="M4.8 8.1v9.7a2.7 2.7 0 0 0 2.7 2.7h7.7" />
        </>
      ) : null}
      {name === "text" ? (
        <path {...common} d="M6 7.4V5.4h12v2M12 5.4v13.2M9.5 18.6h5" />
      ) : null}
      {name === "pen" ? (
        <>
          <path
            {...common}
            d="m4.9 19.1 1-3.9L16 5.1a2.05 2.05 0 0 1 2.9 2.9L8.8 18.1l-3.9 1Z"
          />
          <path {...common} d="m13.9 7.2 2.9 2.9" />
        </>
      ) : null}
      {name === "highlighter" ? (
        <>
          <path
            {...common}
            d="M5.6 17.9 14.7 8.8l1.7-1.7a1.95 1.95 0 0 1 2.75 0l.35.35a1.95 1.95 0 0 1 0 2.75L17.8 11.9l-9.1 9.1H5.6v-3.1Z"
          />
          <path {...common} d="M4.6 21h9.2" />
        </>
      ) : null}
      {name === "eraser" ? (
        <>
          <path
            {...common}
            d="M13.6 5.7 5.5 13.8a2 2 0 0 0 0 2.85l2.15 2.15a2 2 0 0 0 1.4.6h3.25l6.1-6.1a2 2 0 0 0 0-2.85l-2.9-2.9a2 2 0 0 0-2.85 0Z"
          />
          <path {...common} d="m9.3 10 4.9 4.9M12.7 19.4h6.7" />
        </>
      ) : null}
      {name === "undo" ? (
        <>
          <path {...common} d="M9 13.6 4.5 9.1 9 4.6" />
          <path {...common} d="M4.5 9.1h9.6a5.35 5.35 0 0 1 0 10.7H9.2" />
        </>
      ) : null}
      {name === "redo" ? (
        <>
          <path {...common} d="M15 13.6l4.5-4.5L15 4.6" />
          <path {...common} d="M19.5 9.1H9.9a5.35 5.35 0 0 0 0 10.7h4.9" />
        </>
      ) : null}
      {name === "chevron" ? (
        <path {...common} d="m7 10.4 5 5 5-5" />
      ) : null}
      {name === "options" ? (
        <>
          <circle cx="5" cy="12" r="1.35" fill="currentColor" />
          <circle cx="12" cy="12" r="1.35" fill="currentColor" />
          <circle cx="19" cy="12" r="1.35" fill="currentColor" />
        </>
      ) : null}
      {name === "trash" ? (
        <>
          <path
            {...common}
            d="M4.5 6.6h15M9.5 6.6V5.2a1.6 1.6 0 0 1 1.6-1.6h1.8a1.6 1.6 0 0 1 1.6 1.6v1.4"
          />
          <path
            {...common}
            d="m18.3 6.6-.85 12a2 2 0 0 1-2 1.85H8.55a2 2 0 0 1-2-1.85l-.85-12"
          />
          <path {...common} d="M10.1 10.6v5.8M13.9 10.6v5.8" />
        </>
      ) : null}
      {name === "plus" ? (
        <path {...common} d="M12 5.5v13M5.5 12h13" />
      ) : null}
      {name === "check" ? (
        <path {...common} d="m5.5 12.6 4.2 4.2 8.8-9.4" />
      ) : null}
      {name === "alert" ? (
        <>
          <circle {...common} cx="12" cy="12" r="8.25" />
          <path {...common} d="M12 8v4.6M12 15.9h.01" />
        </>
      ) : null}
      {name === "close" ? (
        <path {...common} d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
      ) : null}
    </svg>
  );
}

export default function ToolbarIconButton({
  label,
  icon,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  icon: NotebookIconName;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      data-notebook-toolbar-action="true"
      onClick={onClick}
      className={`relative inline-flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:!border-[var(--button-disabled-border)] disabled:!bg-[var(--button-disabled-bg)] disabled:!text-[var(--button-disabled-text)] disabled:saturate-[0.82] ${
        active
          ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-[var(--color-selected-text)] shadow-[0_0_0_3px_rgba(143,125,232,0.18),0_8px_18px_rgba(0,0,0,0.16)]"
          : "border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--button-secondary-text)] hover:-translate-y-0.5 hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)] active:translate-y-0 active:scale-95"
      }`}
    >
      <NotebookIcon name={icon} />
      {children}
    </button>
  );
}
