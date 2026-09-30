"use client";

import { useCallback, useState } from "react";
import {
  answerPlanStep,
  applyJamiReply,
  jumpToPlanStep,
  recordStudentMessage,
  startPlanInterview,
  withPlanDraft,
  type PlanInterviewContext,
  type PlanInterviewState,
  type PlanInterviewStep,
} from "@/lib/planning/plan-interview";
import type { RevisionPlanDraft } from "@/lib/planning/types";
import { draftPlanWithJami, PlanDraftError } from "@/services/planning/plan-draft";

/**
 * The planning interview, held where both halves of the screen can read it.
 *
 * The conversation and the plan beside it are one piece of state: an answer
 * moves both, and "change" on a section of the plan moves the conversation
 * back to that question. The page owns this so the plan survives a trip into
 * the full builder and back.
 *
 * What happens next is always decided by `lib/planning/plan-interview.ts`.
 * This only carries it, and makes the one network call typed answers need.
 */
export function usePlanInterview(context: PlanInterviewContext) {
  const [state, setState] = useState<PlanInterviewState>(() => startPlanInterview({ context }));
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState("");

  /** Jami's reading of something typed, applied to the state it was typed into. */
  const sendFrom = useCallback(
    async (base: PlanInterviewState, text: string) => {
      const said = text.trim();
      if (!said) return;
      setProblem("");
      setState(recordStudentMessage(base, said));
      setThinking(true);
      try {
        const answer = await draftPlanWithJami({
          message: said,
          history: base.turns.map(({ role, text: turnText }) => ({ role, text: turnText })),
          draft: base.draft,
          step: base.step,
        });
        setState((current) =>
          applyJamiReply(current, { text: answer.reply, proposal: answer.plan }, context)
        );
      } catch (error) {
        /*
         * Never a dead end. Every question can still be answered by tapping,
         * which needs no model, so that is what the message offers first.
         */
        setProblem(
          error instanceof PlanDraftError
            ? error.message
            : "Jami couldn't answer just now. You can still answer with the options below, or build the plan yourself."
        );
      } finally {
        setThinking(false);
      }
    },
    [context]
  );

  const send = useCallback(
    (text: string) => {
      if (thinking) return;
      void sendFrom(state, text);
    },
    [sendFrom, state, thinking]
  );

  /**
   * Start again: from the first question, or -- for a running plan -- from the
   * last check with that plan on screen, sending what the student already said
   * about changing it.
   */
  const begin = useCallback(
    (input: { draft?: RevisionPlanDraft | null; reshaping?: boolean; message?: string } = {}) => {
      const fresh = startPlanInterview({
        ...(input.draft ? { draft: input.draft } : {}),
        reshaping: input.reshaping ?? false,
        context,
      });
      setState(fresh);
      setProblem("");
      if (input.message) void sendFrom(fresh, input.message);
    },
    [context, sendFrom]
  );

  /** A tap changed the plan; the conversation has not moved. */
  const setDraft = useCallback((draft: RevisionPlanDraft) => {
    setState((current) => withPlanDraft(current, draft));
  }, []);

  /** A tapped answer: said back in words, and on to the next question. */
  const answer = useCallback(
    (summary: string, draft: RevisionPlanDraft) => {
      setProblem("");
      setState((current) => answerPlanStep(current, summary, draft, context));
    },
    [context]
  );

  const jumpTo = useCallback(
    (step: PlanInterviewStep) => {
      setProblem("");
      setState((current) => jumpToPlanStep(current, step, context));
    },
    [context]
  );

  return {
    ...state,
    thinking,
    problem,
    begin,
    send,
    setDraft,
    answer,
    jumpTo,
  };
}

export type PlanInterview = ReturnType<typeof usePlanInterview>;
