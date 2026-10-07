"use client";

import type { ElementType } from "react";
import { DialogTitle, JamiTutorIcon } from "@/components/ui";
import {
  CloseIcon,
  HistoryIcon,
  NewChatIcon,
  SettingsIcon,
} from "@/components/ai/JamiAssistantIcons";

const ICON_BUTTON_CLASS =
  "inline-grid h-10 w-10 place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45";

/**
 * The top of the chat as a side panel, a full page or a card in the page:
 * who it is, what it is looking at, and the chat's own actions. The floating
 * card has its own header (`JamiFloatingTutorHeader`).
 */
export default function TutorChatHeader({
  inline,
  subtitle,
  historyOpen,
  onToggleHistory,
  onNewChat,
  onOpenSettings,
  onClose,
}: {
  /** A card in the page: its title names no dialog. */
  inline: boolean;
  subtitle: string;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
  /** Left out where Tutor settings are switched off. */
  onOpenSettings?: () => void;
  onClose: () => void;
}) {
  // A dialog's title names the dialog; a card in the page has none to name.
  const ChatTitle: ElementType = inline ? "h2" : DialogTitle;
  return (
    <header className="border-b border-[var(--color-border)] px-4 py-3.5 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
            <JamiTutorIcon className="h-[1.35rem] w-[1.35rem]" />
          </div>
          <div className="min-w-0">
            <ChatTitle className="text-base font-semibold leading-tight text-text-primary">
              Jami
            </ChatTitle>
            <p className="mt-0.5 truncate text-xs text-text-muted">{subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {onOpenSettings ? (
            <button
              type="button"
              aria-label="Open Jami settings"
              title="Jami settings"
              className={ICON_BUTTON_CLASS}
              onClick={onOpenSettings}
            >
              <SettingsIcon />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={historyOpen ? "Return to current Jami chat" : "Open Jami chat history"}
            title={historyOpen ? "Current chat" : "Chat history"}
            className={`inline-grid h-10 w-10 place-items-center rounded-full transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
              historyOpen
                ? "bg-accent/12 text-accent"
                : "text-text-muted hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
            }`}
            onClick={onToggleHistory}
          >
            <HistoryIcon />
          </button>
          <button
            type="button"
            aria-label="Start a new Jami chat"
            title="New chat"
            className={ICON_BUTTON_CLASS}
            onClick={onNewChat}
          >
            <NewChatIcon />
          </button>
          <button
            type="button"
            aria-label="Close Jami assistant"
            title="Close"
            className={ICON_BUTTON_CLASS}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
