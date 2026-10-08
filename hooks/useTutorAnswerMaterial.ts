"use client";

import { useCallback, useState } from "react";
import type { JamiAssistantContext } from "@/lib/ai/jami-assistant";
import {
  getJamiAssistantContextKey,
  getJamiAssistantSavedContext,
} from "@/lib/ai/jami-assistant-history";
import type {
  TutorStudyMaterialChoice,
  TutorStudyMaterialKind,
  TutorStudyMaterialResult,
} from "@/lib/ai/tutor-study-material";
import type { TutorConversation } from "@/hooks/useTutorConversation";

type TutorMaterialChoice = { kind: TutorStudyMaterialKind; choice: TutorStudyMaterialChoice };

/**
 * Flashcards and practice sets made from an answer: which the student asked
 * for under which answer, what they chose on a setup card, and what came back.
 */
export function useTutorAnswerMaterial({
  conversation,
  getContext,
  contextKey,
}: {
  conversation: Pick<TutorConversation, "setMessages">;
  getContext: () => JamiAssistantContext | Promise<JamiAssistantContext>;
  contextKey: string;
}) {
  const { setMessages } = conversation;
  /** Material the student asked for from an offer under an answer, by answer. */
  const [startedMaterial, setStartedMaterial] = useState<Record<string, TutorStudyMaterialKind[]>>(
    {}
  );
  /** What the student chose on a setup card, by answer: made with that, not Tutor's guess. */
  const [materialChoices, setMaterialChoices] = useState<Record<string, TutorMaterialChoice>>({});

  /**
   * The context material is made from, checked against the chat it belongs
   * to: a student who has turned the page since must not have flashcards for
   * the new page filed against the old conversation.
   */
  const getStudyMaterialContext = useCallback(async () => {
    const context = await getContext();
    if (getJamiAssistantContextKey(getJamiAssistantSavedContext(context)) !== contextKey) {
      throw new Error("The study context changed. Open Jami again and retry.");
    }
    return context;
  }, [contextKey, getContext]);

  const recordStudyMaterialResult = useCallback(
    (messageId: string, result: TutorStudyMaterialResult) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                studyMaterialResults: {
                  ...message.studyMaterialResults,
                  [result.kind]: result,
                },
              }
            : message
        )
      );
    },
    [setMessages]
  );

  const startStudyMaterial = (messageId: string, kind: TutorStudyMaterialKind) =>
    setStartedMaterial((current) => ({
      ...current,
      [messageId]: Array.from(new Set([...(current[messageId] ?? []), kind])),
    }));

  const makeFromSetup = (
    messageId: string,
    kind: TutorStudyMaterialKind,
    choice: TutorStudyMaterialChoice
  ) => {
    setMaterialChoices((current) => ({ ...current, [messageId]: { kind, choice } }));
    startStudyMaterial(messageId, kind);
  };

  /** A new chat has asked for nothing yet. */
  const forgetMaterial = useCallback(() => {
    setStartedMaterial({});
    setMaterialChoices({});
  }, []);

  return {
    startedFor: (messageId: string) => startedMaterial[messageId] ?? [],
    choiceFor: (messageId: string): TutorMaterialChoice | undefined => materialChoices[messageId],
    getStudyMaterialContext,
    recordStudyMaterialResult,
    startStudyMaterial,
    makeFromSetup,
    forgetMaterial,
  };
}

export type TutorAnswerMaterial = ReturnType<typeof useTutorAnswerMaterial>;
