"use client";

import { useCallback, useState } from "react";
import type { TodayStudyAction } from "@/lib/dashboard/today-plan";
import type { InterventionDraft } from "@/lib/learning/interventions/draft";
import { noteMissionStarted } from "@/lib/learning/mission-handoff";
import type { Deck } from "@/lib/study/decks";
import { generateInterventionDraft } from "@/services/learning/intervention-generation";
import {
  confirmInterventionDraft,
  type ConfirmedMaterial,
} from "@/services/learning/intervention-material";

/**
 * Generate, review, confirm: the whole of the material flow, in one place.
 *
 * It is one hook rather than three because the states are only meaningful in
 * sequence -- there is no draft without a generation and nothing to write
 * without a draft -- and because every one of them can end the same way, with
 * the student walking away and nothing having happened.
 *
 * The rule the shape enforces: **generating is not doing.** Nothing here
 * records evidence, completes a recommendation or moves a score. A draft that
 * is abandoned leaves no trace at all, and a draft that is confirmed produces
 * material plus somewhere to go and use it -- which is where the work, and the
 * evidence, actually begins.
 */

export type InterventionMaterialState = {
  /** The action currently being written for, so it cannot be asked for twice. */
  generatingId: string | null;
  draft: InterventionDraft | null;
  saving: boolean;
  error: string | null;
  /** What was written, once the student agreed to it. */
  confirmed: (ConfirmedMaterial & { conceptLabel: string }) | null;
};

export function useInterventionMaterial(input: {
  uid: string;
  decks: readonly Deck[];
  folderName: (folderId: string) => string;
}) {
  const { uid, decks, folderName } = input;
  const [state, setState] = useState<InterventionMaterialState>({
    generatingId: null,
    draft: null,
    saving: false,
    error: null,
    confirmed: null,
  });
  // Held from the action that started this, so confirming knows where the
  // material belongs without the draft having to carry a folder around.
  const [folderId, setFolderId] = useState("");

  const start = useCallback(
    async (action: TodayStudyAction) => {
      if (!action.generate || !action.scope.folderId) return;
      setFolderId(action.scope.folderId);
      setState((current) => ({ ...current, generatingId: action.id, error: null, confirmed: null }));
      try {
        const draft = await generateInterventionDraft({
          kind: action.generate.kind,
          conceptId: action.generate.conceptId,
          folderId: action.scope.folderId,
          interventionId: action.id,
        });
        setState((current) => ({ ...current, generatingId: null, draft }));
      } catch (error) {
        setState((current) => ({
          ...current,
          generatingId: null,
          error:
            error instanceof Error ? error.message : "Jami could not write this right now.",
        }));
      }
    },
    []
  );

  const cancel = useCallback(() => {
    // Nothing was written, so nothing is undone.
    setState((current) => ({ ...current, draft: null, saving: false }));
  }, []);

  const confirm = useCallback(
    async (draft: InterventionDraft) => {
      if (!folderId) return;
      setState((current) => ({ ...current, saving: true, error: null }));
      try {
        const written = await confirmInterventionDraft({
          uid,
          draft,
          folderId,
          folderName: folderName(folderId),
          decks,
        });
        /*
         * Agreeing to the material is the moment they take the work on, so it
         * is the moment Today is told to expect it back.
         *
         * Cards need this: the session they lead to knows only an action id,
         * and would have nothing to name when it hands back. A practice paper
         * does not -- its provenance is stored on the paper -- but writing it
         * here costs nothing and covers the student who sits it straight away
         * in this same tab.
         */
        noteMissionStarted({
          actionId: draft.interventionId,
          headline: `Work through ${draft.conceptLabel}`,
          conceptLabel: draft.conceptLabel,
          targetItems: written.created,
        });
        setState({
          generatingId: null,
          draft: null,
          saving: false,
          error: null,
          confirmed: { ...written, conceptLabel: draft.conceptLabel },
        });
      } catch (error) {
        // The review screen stays open, holding the material the student asked
        // for: better than a page that moves on as though something was saved.
        setState((current) => ({
          ...current,
          saving: false,
          error:
            error instanceof Error ? error.message : "Could not save this material.",
        }));
      }
    },
    [decks, folderId, folderName, uid]
  );

  const dismissConfirmation = useCallback(() => {
    setState((current) => ({ ...current, confirmed: null }));
  }, []);

  const dismissError = useCallback(() => {
    setState((current) => ({ ...current, error: null }));
  }, []);

  return { ...state, start, cancel, confirm, dismissConfirmation, dismissError };
}
