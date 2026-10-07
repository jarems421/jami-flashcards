"use client";

import { useCallback, useEffect } from "react";
import type { JamiAssistantThread } from "@/lib/ai/jami-assistant-history";
import { useAssistantThreadList } from "@/hooks/useAssistantThreadList";
import type { TutorConversation } from "@/hooks/useTutorConversation";
import {
  getJamiAssistantThreadMessages,
  toDrawerMessages,
} from "@/services/ai/jami-assistant-history";
import { auth } from "@/services/firebase/client";

/**
 * Saved chats as the drawer uses them: the list, opening one into the
 * conversation, and whether the chat on screen began somewhere else.
 *
 * A chat from another surface can be carried on here, but only read: what it
 * offered to do belonged to the place it started, not to this one.
 */
export function useTutorChatHistory({
  conversation,
  open,
  contextKey,
  onActiveThreadRemoved,
}: {
  conversation: TutorConversation;
  open: boolean;
  contextKey: string;
  /** Deleting the chat that is open; the drawer decides what clearing it means. */
  onActiveThreadRemoved: () => void;
}) {
  const {
    activeThread,
    setActiveThread,
    setMessages,
    setError,
    setHistoryNotice,
    setHistoryOpen,
    setThreadLoading,
    abandonActiveRequest,
  } = conversation;

  const {
    threads,
    loading,
    error,
    setError: setHistoryError,
    refresh,
    promote,
    rename,
    remove,
  } = useAssistantThreadList({
    activeThreadId: activeThread?.id ?? null,
    onActiveThreadRemoved,
  });

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  /**
   * Renaming the open chat has to rename it in the header too, not just in the
   * saved list the hook owns.
   */
  const renameThread = useCallback(
    async (thread: JamiAssistantThread, title: string) => {
      const renamedTitle = await rename(thread, title);
      setActiveThread((current) =>
        current?.id === thread.id ? { ...current, title: renamedTitle } : current
      );
    },
    [rename, setActiveThread]
  );

  const openThread = useCallback(
    async (thread: JamiAssistantThread) => {
      const user = auth.currentUser;
      if (!user) {
        setHistoryError("Sign in again to open your saved chats.");
        return;
      }
      abandonActiveRequest();
      setThreadLoading(true);
      setHistoryError(null);
      setError(null);
      setHistoryNotice(null);
      try {
        const storedMessages = await getJamiAssistantThreadMessages(user.uid, thread.id);
        setMessages(toDrawerMessages(storedMessages));
        setActiveThread(thread);
        setHistoryOpen(false);
      } catch (loadError) {
        setHistoryError(
          loadError instanceof Error ? loadError.message : "That chat could not be opened."
        );
      } finally {
        setThreadLoading(false);
      }
    },
    [
      abandonActiveRequest,
      setActiveThread,
      setError,
      setHistoryError,
      setHistoryNotice,
      setHistoryOpen,
      setMessages,
      setThreadLoading,
    ]
  );

  const viewingForeignThread = activeThread !== null && activeThread.contextKey !== contextKey;
  const latestCurrentThread = threads.find(
    (thread) => thread.contextKey === contextKey && thread.id !== activeThread?.id
  );

  return {
    threads,
    loading,
    error,
    promoteThread: promote,
    renameThread,
    removeThread: remove,
    openThread,
    viewingForeignThread,
    latestCurrentThread,
  };
}
