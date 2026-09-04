"use client";

import { Button } from "@/components/ui";
import { getConstellationBackgroundActionLabel } from "@/lib/constellation/background";

export type ConstellationSkyMode = "arrange" | "connect";

const SKY_MODES = [
  {
    id: "arrange" as const,
    label: "Move",
    hint: "Drag a star to move it. Arrow keys nudge a focused star.",
    icon: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
  },
  {
    id: "connect" as const,
    label: "Connect",
    hint: "Drag from one star to another to join them. Draw the same line again, or tap it, to remove it.",
    icon: "M6 18 18 6M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  },
];

interface ConstellationControlsProps {
  mode: ConstellationSkyMode;
  onModeChange: (mode: ConstellationSkyMode) => void;
  isBackground: boolean;
  onToggleBackground: () => void;
  linkFromStarId: string | null;
  linkHoverStarId: string | null;
  lineCount: number;
  redoCount: number;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

export default function ConstellationControls({
  mode,
  onModeChange,
  isBackground,
  onToggleBackground,
  linkFromStarId,
  linkHoverStarId,
  lineCount,
  redoCount,
  onUndo,
  onRedo,
  onClear,
}: ConstellationControlsProps) {
  const isConnecting = mode === "connect";
  const activeMode = SKY_MODES.find((candidate) => candidate.id === mode) ?? SKY_MODES[0];
  const longestHint = SKY_MODES.map((candidate) => candidate.hint).reduce(
    (longest, hint) => (hint.length > longest.length ? hint : longest)
  );

  return (
    <>
      <div className="app-subtle-panel flex flex-col gap-3 rounded-2xl p-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="What dragging a star does"
          className="flex items-center gap-1 self-start rounded-full bg-glass-subtle p-1"
        >
          {SKY_MODES.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={mode === candidate.id}
              onClick={() => onModeChange(candidate.id)}
              className={`flex min-h-[2.25rem] items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                mode === candidate.id
                  ? "bg-selected-bg text-selected-text"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={candidate.icon} />
              </svg>
              {candidate.label}
            </button>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant={isBackground ? "secondary" : "surface"}
          className="self-start sm:self-auto"
          aria-pressed={isBackground}
          onClick={onToggleBackground}
        >
          {getConstellationBackgroundActionLabel(isBackground)}
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="relative min-w-0 flex-1 text-xs text-text-muted">
          <span aria-hidden="true" className="invisible block">
            {longestHint}
          </span>
          <span className="absolute inset-0 block" aria-live="polite">
            {isConnecting && linkFromStarId
              ? linkHoverStarId
                ? "Let go to join these two."
                : "Now choose another star to join it to. Escape cancels."
              : activeMode.hint}
          </span>
        </div>

        {isConnecting && (lineCount || redoCount) ? (
          <div
            role="toolbar"
            aria-label="Line editing"
            className="flex shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-glass-subtle p-1"
          >
            <LineActionButton
              label="Undo last line"
              title="Undo"
              disabled={!lineCount}
              onClick={onUndo}
              path="M9 7 4 12l5 5 M5 12h8a6 6 0 0 1 6 6"
            />
            <LineActionButton
              label="Restore last undone line"
              title="Redo"
              disabled={!redoCount}
              onClick={onRedo}
              path="m15 7 5 5-5 5 M19 12h-8a6 6 0 0 0-6 6"
            />
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border-subtle" />
            <LineActionButton
              label="Clear all lines"
              title="Clear all lines"
              disabled={!lineCount}
              onClick={onClear}
              danger
              path="M4 7h16 M9 7V4h6v3 m-8.5 0 1 13h9l1-13 M10 11v5M14 11v5"
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function LineActionButton({
  label,
  title,
  disabled,
  onClick,
  path,
  danger = false,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  path: string;
  danger?: boolean;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={`!size-9 rounded-full${danger ? " text-danger-text hover:text-danger-text" : ""}`}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="size-4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path} />
      </svg>
    </Button>
  );
}
