"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { StudyCommitOptions } from "@/components/study/StudyExerciseStage";
import type { StudyExerciseController } from "@/hooks/useStudyExerciseController";
import type { StudySessionIdentity } from "@/hooks/useStudySessionRecord";
import type { Card } from "@/lib/study/cards";
import { resolveCurrentExercise, type ExercisePin } from "@/lib/study/exercise-resolution";
import { addModeAnswer, countAllModeAnswers, countModeAnswers } from "@/lib/study/mode-results";
import { countedDraftKey, presentationDraftKey, resolvePresentationId } from "@/lib/study/presentation-identity";
import { readPresentationViewState, type PresentationViewState } from "@/lib/study/presentation-state";
import { isSuccessfulRating, type CardRating } from "@/lib/study/scheduler";
import type {
  PersistedStudyExercise,
  PersistedStudySession,
  StudyModeResults,
  StudySessionKind,
} from "@/lib/study/session";
import {
  getCardContentHash,
  type StudyAnswerOutcome,
  type StudyMode,
  type StudyModePolicy,
  type StudyVariantReportReason,
} from "@/lib/study/study-modes";
import { recordPresentation } from "@/services/study/presentation-history";
import { checkTypedAnswer, reportStudyVariant } from "@/services/study/study-assets";

type DraftResponses = Record<string, string | Record<string, string>>;

export type PresentationHistory = {
  variants: Record<string, string[]>;
  outcomes: Record<string, StudyAnswerOutcome[]>;
};

/**
 * How the card on screen is being asked, and what each showing has produced.
 *
 * A showing is pinned to one exercise the moment it is resolved, so late
 * preparation, a re-render or a mode read can never swap the question under
 * a student halfway through an answer (see `resolveCurrentExercise`). Every
 * showing's draft, verdict and mode are kept here and saved with the session,
 * so a resumed session asks the same way it was asking.
 */
export function useStudyExercises({
  userId,
  enabled,
  current,
  asked,
  index,
  sessionKind,
  modePolicy,
  identity,
  controller,
  retireAsset,
  prepareRemainingAssets,
  showError,
}: {
  userId: string;
  /** Study modes are switched on, so cards may be asked as exercises. */
  enabled: boolean;
  current: Card | null;
  /** The card on screen with whatever Jami has prepared for it merged in. */
  asked: Card | null;
  index: number;
  sessionKind: StudySessionKind | null;
  modePolicy: StudyModePolicy;
  identity: StudySessionIdentity | null;
  controller: Pick<StudyExerciseController, "commitReview" | "revisitAfterHint" | "presentation">;
  /** Hide a reported question from the prepared material held for the session. */
  retireAsset: (cardId: string, variantId: string) => void;
  prepareRemainingAssets: (cards: Card[]) => Promise<unknown>;
  showError: (message: string) => void;
}) {
  const { commitReview, revisitAfterHint, presentation } = controller;
  const [modeResults, setModeResults] = useState<StudyModeResults>({});
  const [recentModes, setRecentModes] = useState<StudyMode[]>([]);
  const [restoredExercises, setRestoredExercises] = useState<PersistedStudyExercise[]>([]);
  const [reportedPresentations, setReportedPresentations] = useState<Set<string>>(() => new Set());
  const [draftResponses, setDraftResponses] = useState<DraftResponses>({});
  const [variantHistory, setVariantHistory] = useState<Record<string, string[]>>({});
  const [outcomeHistory, setOutcomeHistory] = useState<Record<string, StudyAnswerOutcome[]>>({});
  const [pin, setPin] = useState<ExercisePin | null>(null);
  /**
   * Showings, as `cardId:presentation`, asked as an ordinary flashcard because
   * their question could not be made in time. Kept for the showing, so options
   * that land while the student is looking at the card do not swap it out.
   */
  const [flashcardFallbackKeys, setFlashcardFallbackKeys] = useState<Set<string>>(() => new Set());
  const countedPresentationsRef = useRef(new Set<string>());

  const showingAsFlashcard = current ? flashcardFallbackKeys.has(`${current.id}:${presentation}`) : false;
  const sessionId = identity?.sessionId ?? "session";
  const seed = identity?.seed ?? 0;

  const resolution = useMemo(() => {
    if (!current || !asked || !sessionKind || !enabled || showingAsFlashcard) return null;
    return resolveCurrentExercise({
      card: current,
      asked,
      index,
      presentation,
      policy: modePolicy,
      sessionId,
      seed,
      pinned: pin,
      restoredExercises,
      reportedPresentations,
      retiredVariantIds: asked.studySettings?.generatedStudy?.retiredVariantIds ?? [],
      isRetiredDraft: (variantId) => draftResponses[`retired:${variantId}`] === "1",
      modeCounts: countModeAnswers(modeResults),
      presentationIndex: countAllModeAnswers(modeResults),
      recentModes,
      recentVariantIds: variantHistory[current.id] ?? [],
      recentOutcomes: outcomeHistory[current.id] ?? [],
      newId: () => crypto.randomUUID(),
    });
  }, [
    asked, current, draftResponses, enabled, index, modePolicy, modeResults, outcomeHistory, pin,
    presentation, recentModes, reportedPresentations, restoredExercises, seed, sessionId,
    sessionKind, showingAsFlashcard, variantHistory,
  ]);
  // A new pin settles on the very next pass: the same key then finds it.
  if (resolution?.pin) setPin(resolution.pin);
  const currentExercise = resolution?.exercise ?? null;

  const writeDraft = useCallback((key: string, value: string | Record<string, string>) => {
    setDraftResponses((previous) => ({ ...previous, [key]: value }));
  }, []);

  const dropDraft = useCallback((key: string) => {
    setDraftResponses((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }, []);

  const showAsFlashcard = useCallback((cardId: string, shownAt: number) => {
    setFlashcardFallbackKeys((previous) => new Set(previous).add(`${cardId}:${shownAt}`));
  }, []);

  /** Counted once per showing, whichever way the answer arrives. */
  const recordModeAnswer = useCallback(
    (mode: StudyMode, outcome: StudyAnswerOutcome, assisted: boolean) => {
      const presentationId = pin?.presentationId ?? currentExercise?.presentationId;
      if (!presentationId) return;
      const countedKey = countedDraftKey(presentationId);
      if (draftResponses[countedKey] === "1" || countedPresentationsRef.current.has(presentationId)) return;
      countedPresentationsRef.current.add(presentationId);
      writeDraft(countedKey, "1");
      const variantId = currentExercise?.variantId;
      if (current) {
        void recordPresentation(userId, current.id, {
          id: presentationId,
          sourceHash: getCardContentHash(current),
          mode,
          variantId,
          outcome,
          assisted,
          at: Date.now(),
        });
        if (variantId) {
          setVariantHistory((previous) => ({
            ...previous,
            [current.id]: [...(previous[current.id] ?? []), variantId].slice(-8),
          }));
        }
        setOutcomeHistory((previous) => ({
          ...previous,
          [current.id]: [...(previous[current.id] ?? []), outcome].slice(-5),
        }));
      }
      setRecentModes((previous) => [...previous, mode].slice(-8));
      setModeResults((previous) => addModeAnswer(previous, mode, outcome, assisted));
    },
    [current, currentExercise, draftResponses, pin, userId, writeDraft]
  );

  const handleRating = useCallback(
    (rating: CardRating, options: StudyCommitOptions = {}) => {
      if (!current) return;
      const presentationKey = presentationDraftKey({ sessionId, index, cardId: current.id, presentation });
      const { commitId, persist } = resolvePresentationId({
        pinnedId: pin?.presentationId,
        exerciseId: currentExercise?.presentationId,
        stored: draftResponses[presentationKey],
        sessionId,
        index,
        cardId: current.id,
        newId: () => crypto.randomUUID(),
      });
      if (persist) writeDraft(presentationKey, commitId);
      /*
       * Counted once per presentation, never once per attempt to save it. A
       * failed save leaves the student pressing a rating again, and Smart Mix
       * counted every press -- inflating the summary and, worse, the recent
       * outcomes it picks the next mode from.
       */
      const countedKey = countedDraftKey(commitId);
      if (!currentExercise && enabled && draftResponses[countedKey] !== "1") {
        writeDraft(countedKey, "1");
        recordModeAnswer("classic", isSuccessfulRating(rating) ? "correct" : "incorrect", false);
      }
      return commitReview({
        commitId,
        cardId: current.id,
        rating,
        answeredAt: Date.now(),
        requeueOnMiss: options.requeueOnMiss,
        ...(options.confusedWithLabelId ? { confusedWithLabelId: options.confusedWithLabelId } : {}),
      });
    },
    [
      commitReview, current, currentExercise, draftResponses, enabled, index, pin, presentation,
      recordModeAnswer, sessionId, writeDraft,
    ]
  );

  const handleSemanticCheck = useCallback(
    async (response: string, gapResponses?: Record<string, string>) => {
      if (!current || !currentExercise?.presentationId) return null;
      const checked = await checkTypedAnswer({
        cardId: current.id,
        response,
        sourceHash: currentExercise.cardContentHash,
        presentationId: currentExercise.presentationId,
        assetKey: currentExercise.markingSettings?.generatedStudy?.sourceHash,
        bundleRevision: currentExercise.markingSettings?.generatedStudy?.bundleRevision,
        ...(gapResponses ? { gapResponses, variantId: currentExercise.variantId } : {}),
      });
      return checked && checked.verdict !== "needs-self-grade" ? { ...checked, verdict: checked.verdict } : null;
    },
    [current, currentExercise]
  );

  /** A reported question is hidden at once, and Jami is asked to write another. */
  const handleReportExercise = useCallback(
    (reason: StudyVariantReportReason) => {
      const variantId = currentExercise?.variantId;
      if (!current || !currentExercise || !variantId) return;
      if (currentExercise.presentationId) dropDraft(currentExercise.presentationId);
      setReportedPresentations((previous) => new Set(previous).add(`${current.id}:${presentation}`));
      writeDraft(`retired:${variantId}`, "1");
      setRestoredExercises((previous) => previous.filter((item) => item.variantId !== variantId));
      retireAsset(current.id, variantId);
      setPin(null);
      void reportStudyVariant({
        cardId: current.id,
        variantId,
        bundleVersion: currentExercise.markingSettings?.generatedStudy?.bundleVersion ?? 3,
        reason,
      })
        .then(() => prepareRemainingAssets([current]))
        .catch(() => {
          showError("That question was hidden, but Jami could not save the report just now.");
        });
    },
    [current, currentExercise, dropDraft, prepareRemainingAssets, presentation, retireAsset, showError, writeDraft]
  );

  const stageProps = useMemo(() => {
    if (!current || !currentExercise) return null;
    const { presentationId } = currentExercise;
    const viewStateKey = `state:${presentationId}`;
    const forgetRestored = () =>
      setRestoredExercises((previous) => previous.filter((item) => item.presentationId !== presentationId));
    return {
      viewState: readPresentationViewState(draftResponses[viewStateKey]),
      onViewStateChange: (state: PresentationViewState) => writeDraft(viewStateKey, JSON.stringify(state)),
      onCommit: (rating: CardRating, options?: StudyCommitOptions) => {
        forgetRestored();
        return handleRating(rating, options);
      },
      onModeAnswered: recordModeAnswer,
      onRevisitAfterHint: () => {
        if (presentationId) dropDraft(presentationId);
        const revisitKey = `hint-revisit:${current.id}`;
        const used = draftResponses[revisitKey] === "1";
        writeDraft(revisitKey, "1");
        forgetRestored();
        revisitAfterHint(current.id, used);
      },
      onSemanticCheck: handleSemanticCheck,
      onReportExercise:
        currentExercise.source === "cached-ai" && currentExercise.variantId ? handleReportExercise : undefined,
      draftResponse: presentationId ? draftResponses[presentationId] : undefined,
      onDraftChange: presentationId
        ? (response: string | Record<string, string>) => writeDraft(presentationId, response)
        : undefined,
    };
  }, [
    current, currentExercise, draftResponses, dropDraft, handleRating, handleReportExercise,
    handleSemanticCheck, recordModeAnswer, revisitAfterHint, writeDraft,
  ]);

  /** A new session: nothing answered or pinned yet, with what came before. */
  const begin = useCallback((history: PresentationHistory) => {
    setModeResults({});
    setRecentModes([]);
    setRestoredExercises([]);
    setDraftResponses({});
    setVariantHistory(history.variants);
    setOutcomeHistory(history.outcomes);
    setPin(null);
    setFlashcardFallbackKeys(new Set());
  }, []);

  /** A resumed session, asked exactly as it was being asked. */
  const adopt = useCallback((session: PersistedStudySession) => {
    setModeResults(session.modeResults ?? {});
    setRecentModes(session.recentModes ?? []);
    setDraftResponses(session.draftResponses ?? {});
    setVariantHistory(session.variantHistory ?? {});
    setOutcomeHistory(session.outcomeHistory ?? {});
    setRestoredExercises(session.exercises ?? []);
    setPin(null);
    setFlashcardFallbackKeys(new Set());
  }, []);

  /** No session on screen any more. */
  const reset = useCallback(() => {
    setModeResults({});
    setRecentModes([]);
    setRestoredExercises([]);
    setReportedPresentations(new Set());
    setDraftResponses({});
    setVariantHistory({});
    setOutcomeHistory({});
    setPin(null);
    setFlashcardFallbackKeys(new Set());
  }, []);

  /** Everything a saved copy of the session carries about its showings. */
  const snapshot = useMemo(
    () => ({ modeResults, recentModes, draftResponses, variantHistory, outcomeHistory, pinned: pin }),
    [draftResponses, modeResults, outcomeHistory, pin, recentModes, variantHistory]
  );

  return {
    currentExercise,
    showingAsFlashcard,
    showAsFlashcard,
    recoveryNotice: pin?.recoveryNotice ?? null,
    stageProps,
    handleRating,
    modeResults,
    snapshot,
    begin,
    adopt,
    reset,
  };
}
