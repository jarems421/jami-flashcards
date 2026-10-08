"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CardFaceImage from "@/components/cards/CardFaceImage";
import DiagramZoomDialog from "@/components/cards/DiagramZoomDialog";
import OcclusionFigure from "@/components/cards/OcclusionFigure";
import { Button, Input, StudyText } from "@/components/ui";
import StudyAnswerEntry, {
  StudyPromptText,
  type AnswerEntryState,
} from "@/components/study/StudyAnswerEntry";
import StudyMultipleChoice from "@/components/study/StudyMultipleChoice";
import StudyRatingControls from "@/components/study/StudyRatingControls";
import {
  markTypedAnswer,
  type MarkedAnswer,
} from "@/lib/study/answer-marking";
import { markClozeAnswers, renderClozePrompt, renderMultiClozePrompt } from "@/lib/study/gap-fill";
import type { PresentationViewState } from "@/lib/study/presentation-state";
import { mergeGapOutcomes } from "@/lib/study/semantic-validation";
import type { Card } from "@/lib/study/cards";
import { findConfusedLabel } from "@/lib/study/diagram-confusion";
import { getOcclusionLabel, getOcclusionPrompt } from "@/lib/study/image-occlusion";
import type { CardRating } from "@/lib/study/scheduler";
import {
  resolveAttemptOutcome,
  type ResolvedExercise,
  type StudyAnswerOutcome,
  type StudyMode,
  type StudyVariantReportReason,
} from "@/lib/study/study-modes";

type StudyExerciseStageProps = {
  card: Card;
  exercise: ResolvedExercise;
  /**
   * The scale a self-graded answer is rated on.
   *
   * Simple Study asks the same questions as everything else and then answers
   * them on two points, because it never moves a schedule and so has nothing
   * for the middle two of the four to feed.
   */
  ratingScale?: "two-point" | "four-point";
  savingRating: CardRating | null;
  /**
   * Commit a rating through the study controller.
   *
   * A missed card is sent to the back of the session, not dropped: getting it
   * wrong and never seeing it again is the one outcome that teaches nothing.
   */
  onCommit: (rating: CardRating, options?: StudyCommitOptions) => void | Promise<void>;
  onModeAnswered: (mode: StudyMode, verdict: StudyAnswerOutcome, assisted: boolean) => void;
  onRevisitAfterHint?: () => void;
  /**
   * Ask a semantic marker about prose the local tiers could not decide.
   *
   * Optional, and null from it is not a failure -- it means the student rates
   * this one, which is what would have happened anyway.
   */
  onSemanticCheck?: (response: string, gapResponses?: Record<string, string>) => Promise<{
    verdict: "correct" | "partial" | "incorrect";
    feedback?: string;
    missingConcepts?: string[];
    gapResults?: MarkedAnswer["gapResults"];
  } | null>;
  onReportExercise?: (reason: StudyVariantReportReason) => void;
  draftResponse?: string | Record<string, string>;
  onDraftChange?: (response: string | Record<string, string>) => void;
  viewState?: PresentationViewState;
  onViewStateChange?: (state: PresentationViewState) => void;
};

export type StudyCommitOptions = {
  requeueOnMiss?: boolean;
  /**
   * On a diagram card: the other label the student gave instead of this one.
   * Recorded as an id only, so the pairs a student mixes up can be shown
   * back to them.
   */
  confusedWithLabelId?: string;
};

type RevealState = {
  result: MarkedAnswer;
  response: string;
  /**
   * The rating this answer has already earned, or null when the student is the
   * one who decides. Null is the common case: see `resolveAttemptOutcome`.
   */
  rating: CardRating | null;
  revisit: boolean;
};

const BLANK = "_____";

/**
 * The picture a card asks about, above whatever words go with it.
 *
 * Only a front image reaches an exercise: a card answered by a picture is
 * always flipped, so nothing here has a picture answer to reveal. A diagram is
 * the exception that is not one -- its answer is words, and `revealed`
 * uncovers the box once they have been marked. Multiple choice hides every
 * other label whatever the diagram says, because they are its options.
 */
function PromptImage({
  card,
  revealed = false,
  hideOthers,
  confusedLabelId,
}: {
  card: Card;
  revealed?: boolean;
  hideOthers?: boolean;
  confusedLabelId?: string | null;
}) {
  const [zoomed, setZoomed] = useState(false);
  if (card.occlusion) {
    const phase = revealed ? "answer" : "question";
    const confused = confusedLabelId
      ? card.occlusion.diagram.labels.find((label) => label.id === confusedLabelId)
      : undefined;
    return (
      <div className="w-full space-y-2">
        <OcclusionFigure
          occlusion={card.occlusion}
          phase={phase}
          hideOthers={hideOthers}
          confusedLabelId={confusedLabelId}
          maxHeight="min(52vh, 30rem)"
          className="shadow-card"
          onZoom={() => setZoomed(true)}
        />
        {revealed && confused ? (
          <p role="status" className="text-center text-sm text-text-secondary">
            <span className="occlusion-confused-text font-semibold">{confused.answer}</span> is the label with the dashed amber outline. The one asked has the solid outline.
          </p>
        ) : null}
        <DiagramZoomDialog open={zoomed} title={card.front.trim() || "Diagram"} onClose={() => setZoomed(false)}>
          <OcclusionFigure
            occlusion={card.occlusion}
            phase={phase}
            hideOthers={hideOthers}
            confusedLabelId={confusedLabelId}
            fit="contain"
          />
        </DiagramZoomDialog>
      </div>
    );
  }
  if (!card.frontImage) return null;
  return (
    <CardFaceImage
      source={card.frontImage}
      alt={card.front.trim() ? "Image for this question" : "The question on this card"}
      className="mx-auto max-h-56 w-auto max-w-full rounded-xl object-contain sm:max-h-72"
    />
  );
}

/**
 * The answer-first modes: type it, fill the gap, or pick from four.
 *
 * Classic is deliberately not here. It still runs on the page's own flip state,
 * so the oldest and most-used path keeps behaving exactly as it did.
 *
 * The rule this component exists to enforce is that marking and scheduling are
 * different jobs. It marks, asks `resolveAttemptOutcome` what that is worth,
 * and then either commits a rating or reveals the answer and hands the decision
 * to the student. It never picks a rating of its own.
 */
export default function StudyExerciseStage({
  card,
  exercise,
  ratingScale = "four-point",
  savingRating,
  onCommit,
  onModeAnswered,
  onRevisitAfterHint,
  onSemanticCheck,
  onReportExercise,
  draftResponse,
  onDraftChange,
  viewState = {},
  onViewStateChange,
}: StudyExerciseStageProps) {
  const restoredResult: MarkedAnswer | undefined = viewState.result ?? (viewState.phase === "checking"
    ? { verdict: "needs-self-grade", shape: "short", feedback: "The check was interrupted. Compare your answer and rate it." } : undefined);
  const [entryState, setEntryState] = useState<AnswerEntryState>(restoredResult ? { phase: "marked", result: restoredResult } : { phase: "answering" });
  const [reveal, setReveal] = useState<RevealState | null>(() => {
    if (!restoredResult) return null;
    const outcome = resolveAttemptOutcome(restoredResult.verdict, { hintUsed: viewState.hintUsed });
    return { result: restoredResult, response: typeof draftResponse === "string" ? draftResponse : Object.values(draftResponse ?? {}).join(" · "), rating: outcome.kind === "commit" ? outcome.rating : null, revisit: outcome.kind === "revisit" };
  });
  const [hintUsed, setHintUsed] = useState(viewState.hintUsed === true);
  const submittingRef = useRef(Boolean(restoredResult));
  const [gapResponses, setGapResponses] = useState<Record<string, string>>(
    draftResponse && typeof draftResponse === "object" ? draftResponse : {}
  );
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  // Only a diagram's picture changes once a choice is made: the box uncovers.
  const [chosenId, setChosenId] = useState<string | null>(viewState.chosenId ?? null);
  // A diagram card's words: its header, or what to do when it has none.
  const promptText = card.occlusion ? getOcclusionPrompt(card.occlusion, exercise.prompt) : exercise.prompt;
  const diagramNote = card.occlusion ? getOcclusionLabel(card.occlusion).label?.note : undefined;
  /*
   * On a diagram, which neighbour a wrong answer named: the picked option, or
   * the typed words. Shown in amber beside the right label, and sent with the
   * rating so the pairs a student mixes up can be shown back to them.
   */
  const confusedLabelId = useMemo(() => {
    if (!card.occlusion) return null;
    if (exercise.mode === "multiple-choice") {
      if (!chosenId || chosenId === exercise.mcq?.correctOptionId) return null;
      const option = exercise.mcq?.options.find((entry) => entry.id === chosenId);
      return option ? findConfusedLabel(card.occlusion, option.text) : null;
    }
    if (!reveal || reveal.result.verdict === "correct") return null;
    return findConfusedLabel(card.occlusion, reveal.response);
  }, [card.occlusion, chosenId, exercise.mcq, exercise.mode, reveal]);
  const commitOptions: StudyCommitOptions = {
    requeueOnMiss: true,
    ...(confusedLabelId ? { confusedWithLabelId: confusedLabelId } : {}),
  };

  // Nothing resets state here. The page keys this component on the card and the
  // mode, so a new question arrives as a new component: no cascade of clearing
  // effects, and no window in which last card's verdict is on screen under the
  // next card's question.

  const settle = useCallback(
    (result: MarkedAnswer, response: string) => {
      setEntryState({ phase: "marked", result });
      onViewStateChange?.({ phase: "marked", hintUsed, result });
      onModeAnswered(exercise.mode, result.verdict === "needs-self-grade" || result.verdict === "close" ? "uncertain" : result.verdict, hintUsed);

      const outcome = resolveAttemptOutcome(result.verdict, { hintUsed });
      setReveal({
        result,
        response,
        rating: outcome.kind === "commit" ? outcome.rating : null,
        revisit: outcome.kind === "revisit",
      });
    },
    [exercise.mode, hintUsed, onModeAnswered, onViewStateChange]
  );

  const submit = useCallback(
    (response: string) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      const gap = exercise.mode === "gap-fill" ? exercise.gaps?.[0] : undefined;
      const marked =
        gap
          ? markClozeAnswers({ [gap.id]: response }, [gap]).outcomes[0]
          : markTypedAnswer({
              response,
              expectedAnswer: exercise.expectedAnswer,
              settings: exercise.markingSettings,
            });
      /*
       * On a diagram, an answer that is exactly another label's name is wrong,
       * however many words it shares with the right one: "right atrium" for
       * the left atrium, or "ilium" for the ileum. Local marking alone would be
       * unsure of the first and pass the second as a spelling slip; knowing
       * the diagram, neither is in doubt.
       */
      const namedNeighbour =
        card.occlusion && marked.verdict !== "correct" ? findConfusedLabel(card.occlusion, response) : null;
      const result: MarkedAnswer = namedNeighbour
        ? { ...marked, verdict: "incorrect", feedback: "That is another label on this diagram." }
        : marked;

      // Local marking first, always. The semantic check is only reached for
      // prose it could not call either way, which is why a budget running out
      // costs a tap rather than a broken session.
      if (result.verdict !== "needs-self-grade" || !onSemanticCheck) {
        settle(result, response);
        return;
      }

      setEntryState({ phase: "checking" });
      onViewStateChange?.({ phase: "checking", hintUsed });
      void onSemanticCheck(response, gap ? { [gap.id]: response } : undefined).catch(() => null).then((checked) => {
        if (!mountedRef.current) return;
        if (!checked) {
          settle(result, response);
          return;
        }
        settle(
          {
            ...result,
            verdict: checked.verdict,
            evaluationSource: "semantic",
            ...(checked.missingConcepts?.length
              ? { missingItems: checked.missingConcepts }
              : {}),
            ...(checked.feedback ? { feedback: checked.feedback } : {}),
          },
          response
        );
      });
    },
    [
      card.occlusion,
      exercise.markingSettings,
      exercise.gaps,
      exercise.expectedAnswer,
      exercise.mode,
      onSemanticCheck,
      onViewStateChange,
      hintUsed,
      settle,
    ]
  );

  const skip = useCallback(() => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    settle({ verdict: "incorrect", shape: "short" }, "");
  }, [settle]);

  const submitMultipleGaps = useCallback(() => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const gaps = exercise.gaps ?? [];
    const marked = markClozeAnswers(gapResponses, gaps);
    const local: MarkedAnswer = {
      verdict: marked.verdict,
      shape: "short",
      gapResults: marked.outcomes,
      missingItems: marked.outcomes
        .filter((outcome) => outcome.verdict !== "correct")
        .map((outcome) => gaps.find((gap) => gap.id === outcome.gapId)?.concept ?? "Missing gap"),
    };
    const response = gaps.map((gap) => gapResponses[gap.id] ?? "").join(" · ");
    if (marked.verdict !== "needs-self-grade" || !onSemanticCheck) {
      settle(local, response);
      return;
    }
    setEntryState({ phase: "checking" });
    onViewStateChange?.({ phase: "checking", hintUsed });
    void onSemanticCheck(response, gapResponses).catch(() => null).then((checked) => {
      if (!mountedRef.current) return;
      const merged = mergeGapOutcomes(marked.outcomes, checked?.gapResults);
      settle({ ...local, verdict: merged.verdict, feedback: checked?.feedback, gapResults: merged.outcomes }, response);
    });
  }, [exercise.gaps, gapResponses, onSemanticCheck, settle, onViewStateChange, hintUsed]);

  if (exercise.mode === "multiple-choice" && exercise.mcq) {
    return (
      <div
        data-study-current-card-id={card.id}
        className="mx-auto w-full max-w-[62rem]"
      >
        <StudyMultipleChoice
          prompt={promptText}
          promptMedia={<PromptImage card={card} revealed={chosenId !== null} hideOthers confusedLabelId={confusedLabelId} />}
          question={exercise.mcq}
          initialChosenId={viewState.chosenId}
          onSelectionChange={(chosenId) => {
            // Choosing is the answer, so the box uncovers while the options explain themselves.
            setChosenId(chosenId);
            onViewStateChange?.({ chosenId });
          }}
          onAnswered={(correct) => onModeAnswered("multiple-choice", correct ? "correct" : "incorrect", false)}
          // Picking the answer is the attempt; reading why the others were
          // wrong is not part of it. The rating is settled the moment they
          // choose and committed when they move on, so the explanation can be
          // read for as long as they like without it counting as hesitation.
          onContinue={(correct) =>
            onCommit(correct ? "good" : "again", commitOptions)
          }
          busy={savingRating !== null}
          onReport={onReportExercise}
        />
      </div>
    );
  }

  const gaps = exercise.mode === "gap-fill" ? (exercise.gaps ?? (exercise.cloze ? [{ id: "legacy", ...exercise.cloze, acceptedAnswers: [], concept: exercise.cloze.answer }] : [])) : [];
  if (exercise.mode === "gap-fill" && gaps.length > 1 && reveal) {
    return (
      <div data-study-current-card-id={card.id} className="mx-auto w-full max-w-[62rem] space-y-4">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-5">
          <p role="status" className="mb-2 text-sm font-semibold">{reveal.result.verdict === "correct" ? "Correct" : reveal.result.verdict === "partial" ? "Nearly there" : reveal.rating ? "Not quite" : "Check your answer"}</p>
          {reveal.result.feedback ? <p className="mb-4 text-sm text-text-secondary">{reveal.result.feedback}</p> : null}
          <div className="my-4 grid gap-3 sm:grid-cols-2">
            {gaps.map((gap, index) => {
              const outcome = reveal.result.gapResults?.find((item) => item.gapId === gap.id);
              const label = outcome?.verdict === "correct" ? "Correct" : outcome?.verdict === "partial" ? "Nearly there" : outcome?.verdict === "incorrect" ? "Not quite" : "Check your answer";
              return <div key={gap.id} className="min-w-0 rounded-xl border border-[var(--color-border)] p-4">
                <p className="mb-2 text-xs text-text-muted">Gap {index + 1} · {label}</p>
                <StudyText as="p" text={gapResponses[gap.id] || "No answer"} className="break-words text-sm text-text-primary" />
                {outcome?.verdict !== "correct" ? <StudyText as="p" text={`Expected: ${gap.answer}`} className="mt-2 break-words text-sm text-text-secondary" /> : null}
                {outcome?.feedback ? <p className="mt-2 text-xs text-text-secondary">{outcome.feedback}</p> : null}
              </div>;
            })}
          </div>
          <p className="mb-3 text-2xs font-semibold uppercase tracking-[0.2em] text-text-muted">The answer</p>
          <StudyText as="p" text={card.back} className="whitespace-pre-wrap text-base leading-relaxed text-text-primary sm:text-lg" />
          {reveal.result.missingItems?.length ? <p className="mt-3 text-sm text-text-secondary">Check: {reveal.result.missingItems.join(", ")}</p> : null}
        </div>
        {reveal.revisit && onRevisitAfterHint ? (
          <Button type="button" size="lg" onClick={onRevisitAfterHint}>Continue</Button>
        ) : reveal.rating ? (
          <Button type="button" size="lg" disabled={savingRating !== null} onClick={() => onCommit(reveal.rating!, commitOptions)}>Next card</Button>
        ) : (
          <StudyRatingControls scale={ratingScale} savingRating={savingRating} onRate={(rating) => onCommit(rating, commitOptions)} />
        )}
      </div>
    );
  }
  if (exercise.mode === "gap-fill" && gaps.length > 1 && !reveal) {
    const prompt = renderMultiClozePrompt(card.back, gaps, BLANK);
    const complete = gaps.every((gap) => (gapResponses[gap.id] ?? "").trim());
    return (
      <div data-study-current-card-id={card.id} className="mx-auto w-full max-w-[62rem] space-y-6">
        <div className="space-y-3 text-center">
          <PromptImage card={card} />
          {card.front.trim() ? <StudyText as="p" text={card.front} className="text-sm text-text-muted" /> : null}
          <StudyText as="p" text={prompt} className="whitespace-pre-wrap text-lg font-medium leading-relaxed text-text-primary sm:text-xl" />
        </div>
        <div className="mx-auto grid max-w-2xl gap-3 sm:grid-cols-2">
          {gaps.map((gap, index) => (
            <Input
              key={gap.id}
              label={`Gap ${index + 1}`}
              value={gapResponses[gap.id] ?? ""}
              autoComplete="off"
              disabled={entryState.phase === "checking" || savingRating !== null}
              onChange={(event) => setGapResponses((current) => {
                const next = { ...current, [gap.id]: event.target.value };
                onDraftChange?.(next);
                return next;
              })}
              onKeyDown={(event) => {
                if (!event.repeat && event.key === "Enter" && complete && savingRating === null && entryState.phase !== "checking") {
                  event.preventDefault();
                  submitMultipleGaps();
                }
              }}
            />
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="secondary" onClick={skip}>I don&apos;t know</Button>
          <Button type="button" disabled={!complete || savingRating !== null || entryState.phase === "checking"} onClick={submitMultipleGaps}>{entryState.phase === "checking" ? "Checking…" : "Check answer"}</Button>
        </div>
        {onReportExercise ? <button type="button" onClick={() => onReportExercise("poor-gap")} className="mx-auto block text-xs text-text-muted underline-offset-4 hover:text-text-secondary hover:underline">Something&apos;s wrong</button> : null}
      </div>
    );
  }

  const isGapFill = exercise.mode === "gap-fill" && gaps.length === 1;
  const promptNode = isGapFill ? (
    <div className="space-y-3">
      <PromptImage card={card} />
      {card.front.trim() ? (
        <StudyText
          as="p"
          text={card.front}
          className="text-center text-sm text-text-muted"
        />
      ) : null}
      <StudyText
        as="p"
        text={renderClozePrompt(card.back, gaps[0], BLANK)}
        className="whitespace-pre-wrap text-center text-lg font-medium leading-relaxed text-text-primary sm:text-xl"
      />
    </div>
  ) : (
    <div className="flex w-full flex-col items-center gap-4">
      <PromptImage card={card} revealed={Boolean(reveal)} confusedLabelId={confusedLabelId} />
      {promptText.trim() ? <StudyPromptText text={promptText} /> : null}
    </div>
  );

  // The hint is the first letter and the shape of the word. Enough to unstick a
  // student, never enough to hand them the answer.
  const target = isGapFill ? gaps[0].answer : exercise.expectedAnswer;
  const hint = buildHint(target);

  return (
    <div
      data-study-current-card-id={card.id}
      className="mx-auto w-full max-w-[62rem] space-y-4"
    >
      <StudyAnswerEntry
        promptNode={promptNode}
        label={isGapFill ? "Fill the blank" : "Your answer"}
        placeholder={isGapFill ? "The missing word" : "Type what you remember"}
        multiline={!isGapFill && exercise.expectedAnswer.length > 80}
        state={entryState}
        hint={hint}
        hintUsed={hintUsed}
        onUseHint={() => { setHintUsed(true); onViewStateChange?.({ hintUsed: true }); }}
        onSubmit={submit}
        onSkip={skip}
        initialResponse={typeof draftResponse === "string" ? draftResponse : ""}
        onDraftChange={onDraftChange}
      />
      {isGapFill && onReportExercise ? <button type="button" onClick={() => onReportExercise("poor-gap")} className="mx-auto block text-xs text-text-muted underline-offset-4 hover:text-text-secondary hover:underline">Something&apos;s wrong</button> : null}

      {reveal ? (
        <div className="space-y-4">
          <div className="space-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-5">
            <p role="status" className="text-sm font-semibold text-text-primary">
              {reveal.result.verdict === "correct" ? "Correct" : reveal.result.verdict === "partial" || reveal.result.verdict === "close" ? "Nearly there" : reveal.result.verdict === "incorrect" ? "Not quite" : "Check your answer"}
            </p>
            {reveal.response ? <p className="text-sm text-text-secondary">You wrote: {reveal.response}</p> : null}
            <div className="text-2xs font-semibold uppercase tracking-[0.2em] text-text-muted">
              {isGapFill ? "The missing word" : "The answer"}
            </div>
            <StudyText
              as="p"
              text={isGapFill ? gaps[0].answer : card.back}
              className="whitespace-pre-wrap text-base leading-relaxed text-text-primary sm:text-lg"
            />
            {diagramNote ? <StudyText as="p" text={diagramNote} className="text-sm text-text-secondary" /> : null}
            {reveal.result.feedback ? <p className="text-sm text-text-secondary">{reveal.result.feedback}</p> : null}
            {reveal.result.missingItems?.length ? <p className="text-sm text-text-secondary">Missing: {reveal.result.missingItems.join(", ")}</p> : null}

          </div>

          {reveal.revisit && onRevisitAfterHint ? (
            <div className="space-y-2"><p className="text-sm text-text-secondary">The hint helped. This card will return once more without help.</p><Button type="button" size="lg" onClick={onRevisitAfterHint}>Continue</Button></div>
          ) : reveal.rating ? (
            <Button
              type="button"
              size="lg"
              disabled={savingRating !== null}
              onClick={() => onCommit(reveal.rating!, commitOptions)}
            >
              Next card
            </Button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-text-secondary">
                {reveal.result.verdict === "needs-self-grade"
                  ? "Jami cannot judge a written answer like this one without guessing. How well did you actually recall it?"
                  : "Close enough to be worth your judgement. How well did you actually recall it?"}
              </p>
              <StudyRatingControls
                scale={ratingScale}
                savingRating={savingRating}
                onRate={(rating) => onCommit(rating, commitOptions)}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function buildHint(answer: string) {
  const trimmed = answer.trim();
  if (!trimmed) return undefined;
  const words = trimmed.split(/\s+/);
  if (words.length > 6) {
    return `Think about the key relationship or cause. Your wording does not need to match the card.`;
  }
  return words
    .map((word) => (word.length > 1 ? `${word[0]}${"·".repeat(word.length - 1)}` : word))
    .join(" ");
}
