"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { JamiTutorIcon } from "@/components/ui";
import FloatingResizeHandles from "@/components/ui/FloatingResizeHandles";
import { useFloatingPanel } from "@/hooks/useFloatingPanel";
import type { FloatingRect } from "@/lib/ui/floating-panel";
import { CloseIcon } from "@/components/ai/JamiAssistantIcons";

/**
 * The pieces of Jami that float over a page being written on.
 *
 * The drawer owns the conversation; this owns where it sits. The card can be
 * dragged and resized anywhere on screen up to the whole window, shrunk to a
 * pill, or reduced to one pinned answer to copy from while writing.
 */

/** Where a floating Jami went when it left the screen, if anywhere. */
export type FloatingTutorStowed = "pill" | "pinned" | null;

/*
 * The card starts about the width of the empty margin beside an A4 page fitted
 * to a landscape tablet, so on first open it covers the margin, not the
 * working. The minimum keeps the header's controls and a readable line.
 */
const CARD_SIZE = { width: 360, height: 560 };
const CARD_LIMITS = { minWidth: 340, minHeight: 340, margin: 12 };
const PIN_SIZE = { width: 300, height: 220 };
const PIN_LIMITS = { minWidth: 220, minHeight: 120, margin: 12 };

type FloatingFrame = ReturnType<typeof useFloatingPanel>;

export function useFloatingTutorFrames(floating: boolean, stowed: FloatingTutorStowed) {
  const card = useFloatingPanel({
    storageKey: "jami:tutor-card:v1",
    enabled: floating,
    preferredSize: CARD_SIZE,
    limits: CARD_LIMITS,
  });
  const pin = useFloatingPanel({
    storageKey: "jami:tutor-pin:v1",
    enabled: floating && stowed === "pinned",
    preferredSize: PIN_SIZE,
    limits: PIN_LIMITS,
  });
  return { card, pin };
}

export const FLOATING_TUTOR_PANEL_CLASS =
  "pointer-events-auto fixed flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border-strong)] shadow-shell";

export const FLOATING_TUTOR_HEADER_CLASS =
  "relative cursor-grab touch-none select-none border-b border-[var(--color-border)] px-3 pb-2.5 pt-4 active:cursor-grabbing";

export function floatingRectStyle(rect: FloatingRect) {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

const ICON_BUTTON_CLASS =
  "inline-grid h-10 w-10 shrink-0 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45";

/** The short bar that says the card can be picked up and moved. */
export function FloatingTutorGrabBar() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-[var(--color-border-strong)]"
    />
  );
}

/** Invisible edge strips and corner grips, laid over the panel they resize. */
export function FloatingTutorResizeFrame({
  frame,
  label,
}: {
  frame: FloatingFrame;
  label: string;
}) {
  if (!frame.rect || frame.maximised) return null;
  return (
    <div className="pointer-events-none fixed" style={floatingRectStyle(frame.rect)}>
      <FloatingResizeHandles getHandleProps={frame.getResizeHandleProps} label={label} />
    </div>
  );
}

export function FloatingTutorCardControls({
  maximised,
  onToggleMaximised,
  onMinimise,
}: {
  maximised: boolean;
  onToggleMaximised: () => void;
  onMinimise: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label={maximised ? "Restore Jami to its card" : "Make Jami full size"}
        title={maximised ? "Restore size" : "Full size"}
        className={ICON_BUTTON_CLASS}
        onClick={onToggleMaximised}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          <path
            d={
              maximised
                ? "M8 3v5H3M12 17v-5h5M8 8 3 3M12 12l5 5"
                : "M12 3h5v5M8 17H3v-5M17 3l-5.5 5.5M3 17l5.5-5.5"
            }
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Shrink Jami to a button"
        title="Shrink"
        className={ICON_BUTTON_CLASS}
        onClick={onMinimise}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          <path d="M5 10h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </>
  );
}

function PinIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M10 13.5V18M7.2 2.5h5.6l-.9 5 2.6 2.6v1.9H5.5v-1.9l2.6-2.6z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Under an answer: keep just this one on screen while writing from it. */
export function FloatingTutorPinButton({ onPin }: { onPin: () => void }) {
  return (
    <button
      type="button"
      className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-accent/25 bg-accent/8 px-2.5 text-2xs font-semibold text-accent transition duration-fast hover:border-accent/40 hover:bg-accent/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
      onClick={onPin}
    >
      <PinIcon />
      Keep beside page
    </button>
  );
}

function FloatingLayer({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  // Over the page and its toolbars, under every dialog (which start at 100).
  return createPortal(<div className="relative z-[90]">{children}</div>, document.body);
}

/** Jami, out of the way: one tap brings the card back as it was. */
export function FloatingTutorPill({ onOpen }: { onOpen: () => void }) {
  return (
    <FloatingLayer>
      <button
        type="button"
        aria-label="Open Jami"
        className="fixed right-4 flex h-[3.25rem] items-center gap-2.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] py-2 pl-2 pr-4 text-sm font-semibold text-text-primary shadow-shell transition duration-fast hover:border-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        style={{
          // Clear of the notebook's page navigation, which owns the corner itself.
          bottom: "calc(max(0.75rem, env(safe-area-inset-bottom)) + 3.75rem)",
          backgroundColor: "var(--color-surface-base)",
          backgroundImage:
            "linear-gradient(var(--color-surface-panel-strong), var(--color-surface-panel-strong))",
        }}
        onClick={onOpen}
      >
        <span className="grid h-9 w-9 place-items-center rounded-full border border-accent/30 bg-accent/15 text-accent">
          <JamiTutorIcon className="h-5 w-5" />
        </span>
        Ask Jami
      </button>
    </FloatingLayer>
  );
}

/**
 * One answer kept on screen, small enough to sit in the page's margin while
 * the student copies from it.
 */
export function FloatingTutorPinnedAnswer({
  frame,
  children,
  onOpenChat,
  onUnpin,
}: {
  frame: FloatingFrame;
  children: ReactNode;
  onOpenChat: () => void;
  onUnpin: () => void;
}) {
  if (!frame.rect) return null;
  return (
    <FloatingLayer>
      <aside
        aria-label="Pinned answer from Jami"
        className="fixed flex flex-col overflow-hidden rounded-2xl border border-accent/35 shadow-shell"
        style={{
          ...floatingRectStyle(frame.rect),
          backgroundColor: "var(--color-surface-base)",
          backgroundImage:
            "linear-gradient(var(--color-surface-panel-strong), var(--color-surface-panel-strong))",
        }}
      >
        <div
          className="relative flex shrink-0 cursor-grab touch-none select-none items-center gap-2 pb-0.5 pl-3.5 pr-1 pt-3 active:cursor-grabbing"
          {...frame.dragHandleProps}
        >
          <FloatingTutorGrabBar />
          <span className="text-accent">
            <PinIcon />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-accent">
            Pinned from Jami
          </span>
          <button
            type="button"
            aria-label="Unpin this answer"
            title="Unpin"
            className={ICON_BUTTON_CLASS}
            onClick={onUnpin}
          >
            <CloseIcon />
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 text-sm leading-relaxed text-text-primary"
          data-notebook-selectable-text="true"
        >
          {children}
        </div>
        <button
          type="button"
          className="flex min-h-11 shrink-0 items-center justify-center gap-1.5 border-t border-[var(--color-border)] text-xs font-semibold text-accent transition duration-fast hover:bg-[var(--color-glass-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/45"
          onClick={onOpenChat}
        >
          Open chat
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
            <path d="M6 14 14 6M7.5 6H14v6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </aside>
      <FloatingTutorResizeFrame frame={frame} label="pinned answer" />
    </FloatingLayer>
  );
}
