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
 * dragged anywhere and resized from any edge or corner, like an image, from
 * small enough to sit in a margin up to the whole window, or shrunk to a pill.
 * One answer can be pinned beside the page to copy from while writing, with
 * the card still open for the next question or put away.
 */

/*
 * The card starts about the width of the empty margin beside an A4 page fitted
 * to a landscape tablet, so on first open it covers the margin, not the
 * working. The minimum is the smallest size at which a message and the
 * composer still both fit.
 */
const CARD_SIZE = { width: 360, height: 560 };
const CARD_LIMITS = { minWidth: 288, minHeight: 320, margin: 12 };
const PIN_SIZE = { width: 300, height: 220 };
const PIN_LIMITS = { minWidth: 200, minHeight: 110, margin: 12 };

export type FloatingFrame = ReturnType<typeof useFloatingPanel>;

export function useFloatingTutorFrames(floating: boolean, pinned: boolean) {
  const card = useFloatingPanel({
    storageKey: "jami:tutor-card:v1",
    enabled: floating,
    preferredSize: CARD_SIZE,
    limits: CARD_LIMITS,
  });
  const pin = useFloatingPanel({
    storageKey: "jami:tutor-pin:v1",
    enabled: floating && pinned,
    preferredSize: PIN_SIZE,
    limits: PIN_LIMITS,
  });
  return { card, pin };
}

/**
 * Whether the card is small enough that its chrome should step back.
 *
 * Below this the chat's own actions fold into one menu and the composer loses
 * its second row, so a card sized to a page margin is mostly conversation.
 */
export function isCompactFloatingCard(rect: FloatingRect | null) {
  return rect !== null && (rect.width < 460 || rect.height < 500);
}

export function floatingTutorPanelClass(frame: FloatingFrame) {
  return `pointer-events-auto fixed flex flex-col overflow-hidden rounded-2xl border shadow-shell transition-[border-color,box-shadow] duration-fast ${
    frame.activeGesture
      ? "border-accent/70 ring-2 ring-accent/25"
      : "border-[var(--color-border-strong)]"
  }`;
}

export function floatingRectStyle(rect: FloatingRect) {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

export const FLOATING_ICON_BUTTON_CLASS =
  "inline-grid h-9 w-9 shrink-0 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45";

/** The short bar that says a panel can be picked up and moved. */
export function FloatingGrabBar() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-[var(--color-border-strong)]"
    />
  );
}

/** Resize handles laid over the panel they resize; gone at full size. */
export function FloatingTutorResizeFrame({ frame }: { frame: FloatingFrame }) {
  if (!frame.rect || frame.maximised) return null;
  return (
    <div className="pointer-events-none fixed" style={floatingRectStyle(frame.rect)}>
      <FloatingResizeHandles getHandleProps={frame.getResizeHandleProps} />
    </div>
  );
}

export function PinIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
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

/**
 * Beside an answer: keep just this one on screen while writing from it.
 *
 * Only a pin, in the answer's own muted grey. It was a labelled accent pill on
 * a row of its own under every answer, which made each reply end in a button
 * asking to be pressed. The label is still there for a screen reader and a
 * hover, and the pin lights up once a finger or pointer finds it.
 */
export function FloatingTutorPinButton({ onPin }: { onPin: () => void }) {
  return (
    <button
      type="button"
      aria-label="Keep beside page"
      title="Keep beside page"
      className="-my-1 inline-grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-muted opacity-70 transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-accent hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 active:text-accent active:opacity-100"
      onClick={onPin}
    >
      <PinIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function FloatingLayer({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  // Over the page and its toolbars, under every dialog (which start at 100).
  return createPortal(<div className="relative z-[90]">{children}</div>, document.body);
}

const OPAQUE_PANEL_STYLE = {
  backgroundColor: "var(--color-surface-base)",
  backgroundImage:
    "linear-gradient(var(--color-surface-panel-strong), var(--color-surface-panel-strong))",
};

/** Jami, out of the way: one tap brings the card back as it was. */
export function FloatingTutorPill({ onOpen }: { onOpen: () => void }) {
  return (
    <FloatingLayer>
      <button
        type="button"
        aria-label="Open Jami"
        className="fixed right-4 flex h-[3.25rem] items-center gap-2.5 rounded-full border border-[var(--color-border-strong)] py-2 pl-2 pr-4 text-sm font-semibold text-text-primary shadow-shell transition duration-fast hover:border-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
        style={{
          ...OPAQUE_PANEL_STYLE,
          // Clear of the notebook's page navigation, which owns the corner itself.
          bottom: "calc(max(0.75rem, env(safe-area-inset-bottom)) + 3.75rem)",
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
 * the student copies from it. Moved and resized like the card, and shown
 * whether or not the card is open.
 */
export function FloatingTutorPinnedAnswer({
  frame,
  children,
  onOpenChat,
  onUnpin,
}: {
  frame: FloatingFrame;
  children: ReactNode;
  /** Brings the chat back. Left out while the chat is already open. */
  onOpenChat?: () => void;
  onUnpin: () => void;
}) {
  if (!frame.rect) return null;
  return (
    <FloatingLayer>
      <aside
        aria-label="Pinned answer from Jami"
        className={`fixed flex flex-col overflow-hidden rounded-2xl border shadow-shell transition-[border-color,box-shadow] duration-fast ${
          frame.activeGesture ? "border-accent/70 ring-2 ring-accent/25" : "border-accent/35"
        }`}
        style={{ ...floatingRectStyle(frame.rect), ...OPAQUE_PANEL_STYLE }}
      >
        <div
          className="relative flex shrink-0 cursor-grab touch-none select-none items-center gap-2 pb-0.5 pl-3.5 pr-1.5 pt-3 active:cursor-grabbing"
          {...frame.dragHandleProps}
        >
          <FloatingGrabBar />
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
            className={FLOATING_ICON_BUTTON_CLASS}
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
        {onOpenChat ? (
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
        ) : null}
      </aside>
      <FloatingTutorResizeFrame frame={frame} />
    </FloatingLayer>
  );
}
