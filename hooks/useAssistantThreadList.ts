"use client";

import { useCallback, useState } from "react";
import {
  deleteJamiAssistantThread,
  getJamiAssistantThreads,
  renameJamiAssistantThread,
} from "@/services/ai/jami-assistant-history";
import { auth } from "@/services/firebase/client";
import type { JamiAssistantThread } from "@/lib/ai/jami-assistant-history";

/**
 * The drawer's saved-chat list: what is in it, and the three ways it changes.
 *
 * Kept apart from the drawer because none of it is about the conversation on
 * screen. Loading, renaming and deleting a saved chat touch only the list and
 * its own loading and error state, and each reports failure by leaving a
 * message in the history panel rather than interrupting the open conversation.
 *
 * Deleting the chat that is currently open is the one case that reaches back
 * into the conversation, so the caller passes `onActiveThreadRemoved` and keeps
 * ownership of what "clear the drawer" means.
 */
export function useAssistantThreadList({
  activeThreadId,
  onActiveThreadRemoved,
}: {
  activeThreadId: string | null;
  onActiveThreadRemoved: () => void;
}) {
  const [threads, setThreads] = useState<JamiAssistantThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setThreads([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setThreads(await getJamiAssistantThreads(user.uid));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Your previous chats could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  /** Move a chat the drawer has just saved to the top of the list. */
  const promote = useCallback((thread: JamiAssistantThread) => {
    setThreads((current) => [
      thread,
      ...current.filter((candidate) => candidate.id !== thread.id),
    ]);
  }, []);

  const rename = useCallback(
    async (thread: JamiAssistantThread, title: string) => {
      const user = auth.currentUser;
      if (!user) throw new Error("Sign in again to rename this chat.");
      const renamedTitle = await renameJamiAssistantThread(user.uid, thread.id, title);
      setThreads((current) =>
        current.map((candidate) =>
          candidate.id === thread.id
            ? { ...candidate, title: renamedTitle, updatedAt: Date.now() }
            : candidate
        )
      );
      return renamedTitle;
    },
    []
  );

  const remove = useCallback(
    async (thread: JamiAssistantThread) => {
      const user = auth.currentUser;
      if (!user) throw new Error("Sign in again to delete this chat.");
      await deleteJamiAssistantThread(user.uid, thread.id);
      setThreads((current) =>
        current.filter((candidate) => candidate.id !== thread.id)
      );
      if (activeThreadId === thread.id) onActiveThreadRemoved();
    },
    [activeThreadId, onActiveThreadRemoved]
  );

  return { threads, loading, error, setError, refresh, promote, rename, remove };
}
