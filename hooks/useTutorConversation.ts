"use client";

import { useCallback, useRef, useState } from "react";
import type { JamiAssistantThread } from "@/lib/ai/jami-assistant-history";
import type { TutorChatMessage } from "@/lib/ai/tutor-chat-messages";

/** The answer being written: which request it is, and how to stop it. */
export type TutorChatRequest = { id: number; controller: AbortController };

/**
 * The Tutor conversation on screen, and the one answer that may be in flight.
 *
 * State only. Sending, opening saved chats and the work under each answer are
 * separate hooks that read and change this, so each can be followed on its
 * own and none of them owns what "start again" means.
 */
export function useTutorConversation({ startInHistory }: { startInHistory: boolean }) {
  const [messages, setMessages] = useState<TutorChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(startInHistory);
  const [threadLoading, setThreadLoading] = useState(false);
  const [activeThread, setActiveThread] = useState<JamiAssistantThread | null>(null);

  const requestIdRef = useRef(0);
  const requestPendingRef = useRef(false);
  /**
   * The in-flight answer, so leaving can stop it.
   *
   * Bumping `requestIdRef` only made the drawer ignore what came back; the
   * route carried on generating and the request stayed charged. Dropping the
   * fetch is what actually tells the server to stop.
   */
  const requestAbortRef = useRef<AbortController | null>(null);

  const abandonActiveRequest = useCallback(() => {
    requestIdRef.current += 1;
    requestPendingRef.current = false;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
  }, []);

  /** Starts the next answer, or nothing while one is still being written. */
  const beginRequest = useCallback((): TutorChatRequest | null => {
    if (requestPendingRef.current) return null;
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    requestPendingRef.current = true;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    return { id, controller };
  }, []);

  /** Whether this is still the answer the chat is waiting for. */
  const isCurrentRequest = useCallback(
    (request: TutorChatRequest) => requestIdRef.current === request.id,
    []
  );

  /** Lets go of an answer that has finished, failed or been stopped. */
  const endRequest = useCallback((request: TutorChatRequest) => {
    if (requestAbortRef.current === request.controller) {
      requestAbortRef.current = null;
    }
    if (requestIdRef.current === request.id) {
      requestPendingRef.current = false;
      setLoading(false);
    }
  }, []);

  /** Back to an empty chat, stopping any answer on the way: a new chat and a new surface share it. */
  const clearConversation = useCallback(() => {
    abandonActiveRequest();
    setMessages([]);
    setLoading(false);
    setError(null);
    setHistoryNotice(null);
    setHistoryOpen(false);
    setThreadLoading(false);
    setActiveThread(null);
  }, [abandonActiveRequest]);

  return {
    messages,
    setMessages,
    loading,
    setLoading,
    error,
    setError,
    historyNotice,
    setHistoryNotice,
    historyOpen,
    setHistoryOpen,
    threadLoading,
    setThreadLoading,
    activeThread,
    setActiveThread,
    abandonActiveRequest,
    beginRequest,
    isCurrentRequest,
    endRequest,
    clearConversation,
  };
}

export type TutorConversation = ReturnType<typeof useTutorConversation>;
