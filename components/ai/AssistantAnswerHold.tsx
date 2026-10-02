"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useLongPress, type LongPressHold } from "@/hooks/useLongPress";

export type AssistantAnswerHoldAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
};

/**
 * Parts of an answer with gestures of their own, which a hold must leave be:
 * links and buttons, and the figures and graphs, which have their own "Add to
 * page" and pinch to zoom.
 */
const HOLD_IGNORE_SELECTOR =
  "button, a[href], input, textarea, select, [role='button'], figure, canvas, .ai-drawn-figure, [data-answer-hold-ignore]";

/** Room left between the menu and the edge of the conversation. */
const MENU_EDGE_PX = 8;
/** How far the menu sits from the finger, so the finger does not cover it. */
const MENU_FINGER_GAP_PX = 14;

/** The nearest ancestor that scrolls vertically: the conversation. */
function scrollingAncestor(element: HTMLElement | null) {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * The menu a held answer opens, at the place it was held.
 *
 * In the tree rather than portalled: the Tutor is a dialog, and a menu outside
 * it would count as a press outside, closing the Tutor under it. So it is laid
 * out inside the answer and moved, once measured, to sit above the finger --
 * or below it, near the top of the conversation where above would be cut off --
 * and inside the answer's width.
 */
function AnswerHoldMenu({
  hold,
  actions,
  onClose,
}: {
  hold: LongPressHold<HTMLDivElement>;
  actions: readonly AssistantAnswerHoldAction[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const area = hold.element.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const viewport = scrollingAncestor(hold.element)?.getBoundingClientRect() ?? {
      top: 0,
      bottom: window.innerHeight,
    };
    const x = hold.clientX - area.left;
    const y = hold.clientY - area.top;
    const left = Math.max(0, Math.min(x - width / 2, area.width - width));
    const above = hold.clientY - MENU_FINGER_GAP_PX - height >= viewport.top + MENU_EDGE_PX;
    const below = hold.clientY + MENU_FINGER_GAP_PX + height <= viewport.bottom - MENU_EDGE_PX;
    const top = above || !below ? y - MENU_FINGER_GAP_PX - height : y + MENU_FINGER_GAP_PX;
    setPosition({ left, top });
  }, [hold]);

  useEffect(() => {
    if (position) itemRefs.current[0]?.focus({ preventScroll: true });
  }, [position]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    // Scrolling the conversation would carry the answer away from its menu.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    // A frame later, so the release of the hold that opened it is not a press outside.
    const frame = window.requestAnimationFrame(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("scroll", onScroll, true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // The Tutor is a dialog; Escape here closes the menu, not the Tutor.
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(current + step + items.length) % items.length]?.focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label="Answer actions"
      data-floating-no-drag="true"
      onKeyDown={handleKeyDown}
      className={`absolute z-20 w-max min-w-[11rem] max-w-[calc(100%-0.5rem)] overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-1 shadow-e3 ${
        position ? "animate-fade-in" : "invisible"
      }`}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        backgroundColor: "var(--color-surface-base)",
        backgroundImage:
          "linear-gradient(var(--color-surface-panel-strong), var(--color-surface-panel-strong))",
      }}
    >
      {actions.map((action, index) => (
        <button
          key={action.id}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-text-primary transition duration-fast hover:bg-[var(--color-glass-medium)] focus-visible:bg-[var(--color-glass-medium)] focus-visible:outline-none"
          onClick={() => {
            onClose();
            action.onSelect();
          }}
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center text-text-muted">
            {action.icon}
          </span>
          {action.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A Tutor answer that can be pressed and held, for what is done to the whole
 * answer: add it to the page, keep it beside the page, or select its text.
 *
 * Holding is how a finger asks "what can I do with this" on an iPad, and the
 * buttons under an answer are small and easy to miss there. On a touch screen
 * the answer's text is therefore not selectable by holding -- that is iOS's
 * own hold, and the two cannot share a gesture -- until "Select text" is
 * chosen, which hands holding back to the system for that answer.
 */
export default function AssistantAnswerHold({
  enabled,
  actions,
  className = "",
  children,
}: {
  enabled: boolean;
  actions: readonly AssistantAnswerHoldAction[];
  className?: string;
  children: ReactNode;
}) {
  const [hold, setHold] = useState<LongPressHold<HTMLDivElement> | null>(null);
  const [selecting, setSelecting] = useState(false);
  const holdEnabled = enabled && !selecting && actions.length > 0;
  const close = useCallback(() => setHold(null), []);
  const pressProps = useLongPress<HTMLDivElement>({
    enabled: holdEnabled,
    ignoreSelector: HOLD_IGNORE_SELECTOR,
    onHold: setHold,
  });

  const menuActions: AssistantAnswerHoldAction[] = [
    ...actions,
    {
      id: "select-text",
      label: "Select text",
      icon: (
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 2.75h4M6 13.25h4M8 2.75v10.5" />
          <path d="M2.75 6.5v3M13.25 6.5v3" />
        </svg>
      ),
      onSelect: () => setSelecting(true),
    },
  ];

  return (
    <div className="relative">
      <div
        {...(holdEnabled ? pressProps : {})}
        // Stops iOS selecting the text under a hold; see `[data-answer-hold]` in globals.css.
        data-answer-hold={holdEnabled ? "true" : undefined}
        data-floating-no-drag={holdEnabled ? "true" : undefined}
        data-answer-held={hold && holdEnabled ? "true" : undefined}
        className={`${className} transition duration-fast data-[answer-held=true]:ring-2 data-[answer-held=true]:ring-accent/40`}
      >
        {children}
      </div>
      {hold && holdEnabled ? <AnswerHoldMenu hold={hold} actions={menuActions} onClose={close} /> : null}
    </div>
  );
}
