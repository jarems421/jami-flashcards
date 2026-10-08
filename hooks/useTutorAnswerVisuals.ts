"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssistantIllustration, JamiAssistantContext } from "@/lib/ai/jami-assistant";
import {
  getJamiAssistantContextKey,
  getJamiAssistantSavedContext,
} from "@/lib/ai/jami-assistant-history";
import { tutorAnswerTextForPage, type TutorChatMessage } from "@/lib/ai/tutor-chat-messages";
import type { NotebookImageRef } from "@/lib/workspace/notebooks";
import type { NotebookGraphDraft } from "@/lib/workspace/notebook-graphs";
import type { TutorConversation } from "@/hooks/useTutorConversation";
import {
  createAssistantIllustration,
  insertAssistantIllustration,
} from "@/services/ai/assistant-illustrations";

type TutorAnswerVisualsInput = {
  conversation: Pick<TutorConversation, "setMessages" | "setError">;
  getContext: () => JamiAssistantContext | Promise<JamiAssistantContext>;
  contextKey: string;
  onIllustrationInserted?: (input: { imageRef: NotebookImageRef; contentRevision: number }) => void;
  onBeforeIllustrationInsert?: () => boolean | Promise<boolean>;
  onGraphInsert?: (graph: NotebookGraphDraft) => Promise<boolean>;
  onDrawingInsert?: (file: File) => Promise<boolean>;
  onAnswerInsert?: (text: string) => boolean;
};

/**
 * Pictures Tutor makes for an answer, and putting an answer's words, graphs,
 * figures and pictures onto the open notebook page.
 *
 * Each is checked against the chat it came from: a student who has turned to
 * another notebook must not have this conversation's picture land there.
 */
export function useTutorAnswerVisuals({
  conversation,
  getContext,
  contextKey,
  onIllustrationInserted,
  onBeforeIllustrationInsert,
  onGraphInsert,
  onDrawingInsert,
  onAnswerInsert,
}: TutorAnswerVisualsInput) {
  const { setMessages, setError } = conversation;
  const [generatingIllustrationId, setGeneratingIllustrationId] = useState<string | null>(null);
  const [insertingIllustrationId, setInsertingIllustrationId] = useState<string | null>(null);
  const [insertedIllustrationIds, setInsertedIllustrationIds] = useState<Set<string>>(
    () => new Set()
  );
  /** Graphs already added from this conversation, keyed by their source. */
  const [insertedGraphKeys, setInsertedGraphKeys] = useState<Set<string>>(() => new Set());
  const [insertingGraphKey, setInsertingGraphKey] = useState<string | null>(null);
  /** The answer just added to the page, confirmed beside it for a moment. */
  const [addedAnswerKey, setAddedAnswerKey] = useState<string | null>(null);

  const requestIllustration = useCallback(
    async (input: { threadId: string; messageId: string; context?: JamiAssistantContext }) => {
      if (generatingIllustrationId) return;
      setGeneratingIllustrationId(input.messageId);
      setError(null);
      try {
        const context = input.context ?? (await getContext());
        if (getJamiAssistantContextKey(getJamiAssistantSavedContext(context)) !== contextKey) {
          throw new Error("The study context changed. Open Jami again and retry.");
        }
        const illustration = await createAssistantIllustration({
          ...input,
          context,
        });
        setMessages((current) =>
          current.map((message) =>
            message.id === input.messageId
              ? {
                  ...message,
                  illustrations: [...(message.illustrations ?? []), illustration],
                }
              : message
          )
        );
      } catch (illustrationError) {
        setError(
          illustrationError instanceof Error
            ? illustrationError.message
            : "Jami could not create that visual just now."
        );
      } finally {
        setGeneratingIllustrationId(null);
      }
    },
    [contextKey, generatingIllustrationId, getContext, setError, setMessages]
  );

  const addIllustrationToPage = useCallback(
    async (message: TutorChatMessage, illustration: AssistantIllustration) => {
      if (!message.id || insertingIllustrationId) return;
      setInsertingIllustrationId(illustration.id);
      setError(null);
      try {
        const context = await getContext();
        if (context.surface !== "notebook") {
          throw new Error("Open a notebook page before adding this visual.");
        }
        if (getJamiAssistantContextKey(getJamiAssistantSavedContext(context)) !== contextKey) {
          throw new Error("The notebook page changed. Add the visual from the page you want it on.");
        }
        const ready = await onBeforeIllustrationInsert?.();
        if (ready === false) {
          throw new Error("Save this page before adding the visual.");
        }
        const inserted = await insertAssistantIllustration({
          illustration,
          messageId: message.id,
          notebookId: context.notebookId,
          pageId: context.pageId,
        });
        setInsertedIllustrationIds((current) => {
          const next = new Set(current);
          next.add(illustration.id);
          return next;
        });
        onIllustrationInserted?.(inserted);
      } catch (insertError) {
        setError(
          insertError instanceof Error
            ? insertError.message
            : "That visual could not be added to this page."
        );
      } finally {
        setInsertingIllustrationId(null);
      }
    },
    [
      contextKey,
      getContext,
      insertingIllustrationId,
      onBeforeIllustrationInsert,
      onIllustrationInserted,
      setError,
    ]
  );

  /** Adds a graph from an answer to the page, one at a time. */
  const insertGraph = (key: string, graph: NotebookGraphDraft) => {
    if (!onGraphInsert || insertingGraphKey) return;
    setInsertingGraphKey(key);
    void onGraphInsert(graph)
      .then((added) => {
        if (added) setInsertedGraphKeys((current) => new Set(current).add(key));
      })
      .finally(() => setInsertingGraphKey(null));
  };

  /**
   * Adds a drawn figure to the page as a picture, made by `toFile` only once
   * nothing else is being added.
   */
  const insertDrawing = (key: string, toFile: () => Promise<File>) => {
    if (!onDrawingInsert || insertingGraphKey) return;
    setInsertingGraphKey(key);
    setError(null);
    void toFile()
      .then((file) => onDrawingInsert(file))
      .then((added) => {
        if (added) setInsertedGraphKeys((current) => new Set(current).add(key));
      })
      .catch((drawError: unknown) =>
        setError(
          drawError instanceof Error ? drawError.message : "That figure could not be added to this page."
        )
      )
      .finally(() => setInsertingGraphKey(null));
  };

  useEffect(() => {
    if (!addedAnswerKey) return;
    const timer = window.setTimeout(() => setAddedAnswerKey(null), 2400);
    return () => window.clearTimeout(timer);
  }, [addedAnswerKey]);

  const addAnswerToPage = useCallback(
    (message: TutorChatMessage, key: string) => {
      if (!onAnswerInsert) return;
      setError(null);
      if (onAnswerInsert(tutorAnswerTextForPage(message))) setAddedAnswerKey(key);
    },
    [onAnswerInsert, setError]
  );

  /** A new chat starts with nothing added to the page from it. */
  const forgetInsertedVisuals = useCallback(() => {
    setInsertedIllustrationIds(new Set());
    setInsertedGraphKeys(new Set());
  }, []);

  /** A new surface also lets go of a picture still being made or added. */
  const forgetVisualsInFlight = useCallback(() => {
    setGeneratingIllustrationId(null);
    setInsertingIllustrationId(null);
  }, []);

  return {
    generatingIllustrationId,
    insertingIllustrationId,
    isIllustrationInserted: (id: string) => insertedIllustrationIds.has(id),
    requestIllustration,
    addIllustrationToPage,
    insertingGraphKey,
    isGraphInserted: (key: string) => insertedGraphKeys.has(key),
    insertGraph,
    insertDrawing,
    addedAnswerKey,
    addAnswerToPage,
    forgetInsertedVisuals,
    forgetVisualsInFlight,
  };
}
