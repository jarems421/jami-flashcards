"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { DialogTitle, JamiTutorIcon } from "@/components/ui";
import {
  CloseIcon,
  HistoryIcon,
  NewChatIcon,
  SettingsIcon,
} from "@/components/ai/JamiAssistantIcons";
import {
  FLOATING_ICON_BUTTON_CLASS,
  FloatingGrabBar,
  type FloatingFrame,
} from "@/components/ai/JamiFloatingTutor";

type FloatingTutorHeaderProps = {
  frame: FloatingFrame;
  subtitle: string;
  /** A small card folds the chat's actions into one menu. */
  compact: boolean;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
  /** Absent when Tutor settings are switched off. */
  onOpenSettings?: () => void;
  /** Lives in the composer normally; moves into the menu when the card is compact. */
  folderSources: { on: boolean; onToggle: () => void };
  onMinimise: () => void;
  onClose: () => void;
};

type MenuAction = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** A setting rather than an action: shown with its state as a switch. */
  checked?: boolean;
};

/**
 * The floating card's header: the handle it is carried by, and its controls.
 *
 * Two groups, never mixed. The chat's own actions (history, a new chat,
 * settings) sit inline on a roomy card and fold into one "More" menu on a small
 * one. The window's controls (full size, shrink, close) stay out as one small
 * cluster whatever the size, because they are what a student reaches for while
 * arranging the card around their page.
 */
export default function FloatingTutorHeader({
  frame,
  subtitle,
  compact,
  historyOpen,
  onToggleHistory,
  onNewChat,
  onOpenSettings,
  folderSources,
  onMinimise,
  onClose,
}: FloatingTutorHeaderProps) {
  const showIcon = !frame.rect || frame.rect.width >= 340;
  const chatActions: MenuAction[] = [
    { label: "New chat", icon: <NewChatIcon />, onSelect: onNewChat },
    {
      label: historyOpen ? "Back to chat" : "Chat history",
      icon: <HistoryIcon />,
      onSelect: onToggleHistory,
    },
    ...(onOpenSettings
      ? [{ label: "Jami settings", icon: <SettingsIcon />, onSelect: onOpenSettings }]
      : []),
  ];

  return (
    <header
      className="relative shrink-0 cursor-grab touch-none select-none border-b border-[var(--color-border)] px-3 pb-2.5 pt-4 active:cursor-grabbing"
      title="Drag to move · double-click for full size"
      {...frame.dragHandleProps}
    >
      <FloatingGrabBar />
      <div className="flex items-center gap-2">
        {showIcon ? (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
            <JamiTutorIcon className="h-[1.1rem] w-[1.1rem]" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-sm font-semibold leading-tight text-text-primary">
            Jami
          </DialogTitle>
          <p className="mt-0.5 truncate text-2xs text-text-muted">{subtitle}</p>
        </div>

        {compact ? (
          <MoreMenu
            actions={chatActions}
            setting={{
              label: "Use folder sources",
              icon: <FolderSourcesIcon />,
              onSelect: folderSources.onToggle,
              checked: folderSources.on,
            }}
          />
        ) : (
          <div className="flex shrink-0 items-center gap-0.5">
            {onOpenSettings ? (
              <button
                type="button"
                aria-label="Open Jami settings"
                title="Jami settings"
                className={FLOATING_ICON_BUTTON_CLASS}
                onClick={onOpenSettings}
              >
                <SettingsIcon />
              </button>
            ) : null}
            <button
              type="button"
              aria-label={historyOpen ? "Return to current Jami chat" : "Open Jami chat history"}
              aria-pressed={historyOpen}
              title={historyOpen ? "Current chat" : "Chat history"}
              className={`${FLOATING_ICON_BUTTON_CLASS} ${historyOpen ? "bg-accent/12 text-accent" : ""}`}
              onClick={onToggleHistory}
            >
              <HistoryIcon />
            </button>
            <button
              type="button"
              aria-label="Start a new Jami chat"
              title="New chat"
              className={FLOATING_ICON_BUTTON_CLASS}
              onClick={onNewChat}
            >
              <NewChatIcon />
            </button>
          </div>
        )}

        <div
          role="group"
          aria-label="Arrange Jami"
          className="flex shrink-0 items-center rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-0.5"
        >
          <button
            type="button"
            aria-label={frame.maximised ? "Restore Jami to its card" : "Make Jami full size"}
            title={frame.maximised ? "Restore size" : "Full size"}
            className={FLOATING_ICON_BUTTON_CLASS}
            onClick={frame.toggleMaximised}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d={
                  frame.maximised
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
            className={FLOATING_ICON_BUTTON_CLASS}
            onClick={onMinimise}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path d="M5 10h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Close Jami assistant"
            title="Close"
            className={FLOATING_ICON_BUTTON_CLASS}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </header>
  );
}

function FolderSourcesIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-[1.05rem] w-[1.05rem]">
      <path
        d="M3 6.2c0-.9.7-1.6 1.6-1.6h3.1l1.6 1.7h6.1c.9 0 1.6.7 1.6 1.6v6.5c0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const MENU_ITEM_CLASS =
  "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-text-primary transition duration-fast hover:bg-[var(--color-glass-medium)] focus-visible:bg-[var(--color-glass-medium)] focus-visible:outline-none";

/** The chat's actions, one tap away from a card too small to lay them out. */
function MoreMenu({ actions, setting }: { actions: MenuAction[]; setting: MenuAction }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    // Opening puts focus on the first item, so the arrow keys carry on from there.
    const focusFrame = window.requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>("[role^='menuitem']")?.focus()
    );
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const select = (action: MenuAction) => {
    action.onSelect();
    // A setting stays open so its new state can be seen; an action has done its job.
    if (action.checked === undefined) close(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("[role^='menuitem']")
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      // Handled here so Escape closes the menu, not the whole of Jami behind it.
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    // Positioned from the header's right edge, not the button's, so it stays inside a narrow card.
    <div ref={rootRef} className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="More Jami options"
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={`${FLOATING_ICON_BUTTON_CLASS} ${open ? "bg-[var(--color-glass-medium)] text-text-primary" : ""}`}
        onClick={() => setOpen((current) => !current)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <circle cx="4.5" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="15.5" cy="10" r="1.5" />
        </svg>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label="Jami options"
          className="absolute right-3 top-full z-30 mt-1.5 w-60 max-w-[calc(100%-1.5rem)] cursor-default rounded-xl border border-[var(--color-border-strong)] p-1.5 shadow-e3"
          style={{
            backgroundColor: "var(--color-surface-base)",
            backgroundImage:
              "linear-gradient(var(--color-surface-panel-strong), var(--color-surface-panel-strong))",
          }}
          onKeyDown={handleKeyDown}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => select(action)}
            >
              <span className="grid w-5 place-items-center text-text-muted">{action.icon}</span>
              {action.label}
            </button>
          ))}
          <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={setting.checked}
            className={MENU_ITEM_CLASS}
            onClick={() => select(setting)}
          >
            <span className="grid w-5 place-items-center text-text-muted">{setting.icon}</span>
            <span className="min-w-0 flex-1">{setting.label}</span>
            <span
              aria-hidden="true"
              className={`relative h-5 w-9 shrink-0 rounded-full border transition duration-fast ${
                setting.checked
                  ? "border-accent/40 bg-accent/65"
                  : "border-[var(--color-border-strong)] bg-[var(--color-glass-medium)]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all duration-fast ${
                  setting.checked ? "left-[1.1rem]" : "left-0.5"
                }`}
              />
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
