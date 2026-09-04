"use client";

import { useCallback, useState } from "react";
import { Button, StudyText } from "@/components/ui";
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
import { markClozeAnswer, renderClozePrompt } from "@/lib/study/gap-fill";
import type { Card } from "@/lib/study/cards";
import type { CardRating } from "@/lib/study/scheduler";
import {
  resolveAttemptOutcome,
  type ResolvedExercise,
  type StudyMode,
} from "@/lib/study/study-modes";

type StudyExerciseStageProps = {
  card: Card;
  exercise: ResolvedExercise;
  savingRating: CardRating | null;
  /**
   * Commit a rating through the study controller.
   *
   * A missed card is sent to the back of the session, not dropped: getting it
   * wrong and never seeing it again is the one outcome that teaches nothing.
   */
  onCommit: (rating: CardRating, options?: { requeueOnMiss?: boolean }) => void;
  onModeAnswered: (mode: StudyMode, correct: boolean) => void;
  /**
   * Ask a semantic marker about prose the local tiers could not decide.
   *
   * Optional, and null from it is not a failure -- it means the student rates
   * this one, which is what would have happened anyway.
   */
  onSemanticCheck?: (response: string) => Promise<{
    verdict: "correct" | "partial" | "incorrect";
    feedback?: string;
    missingConcepts?: string[];
  } | null>;
};

type RevealState = {
  result: MarkedAnswer;
  response: string;
  /**
   * The rating this answer has already earned, or null when the student is the
   * one who decides. Null is the common case: see `resolveAttemptOutcome`.
   */
  rating: CardRating | null;
};

const BLANK = "_____";

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
  savingRating,
  onCommit,
  onModeAnswered,
  onSemanticCheck,
}: StudyExerciseStageProps) {
  const [entryState, setEntryState] = useState<AnswerEntryState>({
    phase: "answering",
  });
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [hintUsed, setHintUsed] = useState(false);

  // Nothing resets state here. The page keys this component on the card and the
  // mode, so a new question arrives as a new component: no cascade of clearing
  // effects, and no window in which last card's verdict is on screen under the
  // next card's question.

  const settle = useCallback(
    (result: MarkedAnswer, response: string) => {
      setEntryState({ phase: "marked", result });
      onModeAnswered(exercise.mode, result.verdict === "correct");

      const outcome = resolveAttemptOutcome(result.verdict, { hintUsed });
      if (outcome.kind === "commit" && outcome.rating === "good") {
        // A clean, unaided answer needs no discussion. The banner over the card
        // acknowledges it and the session moves on.
        onCommit(outcome.rating, { requeueOnMiss: true });
        return;
      }
      // Everything else stops here. A student who got it wrong and is never
      // shown the answer has learned nothing from the attempt, so the commit
      // waits for them to have seen it.
      setReveal({
        result,
        response,
        rating: outcome.kind === "commit" ? outcome.rating : null,
      });
    },
    [exercise.mode, hintUsed, onCommit, onModeAnswered]
  );

  const submit = useCallback(
    (response: string) => {
      const result =
        exercise.mode === "gap-fill" && exercise.cloze
          ? markClozeAnswer(response, exercise.cloze, card.studySettings)
          : markTypedAnswer({
              response,
              expectedAnswer: exercise.expectedAnswer,
              settings: card.studySettings,
            });

      // Local marking first, always. The semantic check is only reached for
      // prose it could not call either way, which is why a budget running out
      // costs a tap rather than a broken session.
      if (result.verdict !== "needs-self-grade" || !onSemanticCheck) {
        settle(result, response);
        return;
      }

      setEntryState({ phase: "checking" });
      void onSemanticCheck(response).then((checked) => {
        if (!checked) {
          settle(result, response);
          return;
        }
        settle(
          {
            ...result,
            verdict: checked.verdict,
            ...(checked.missingConcepts?.length
              ? { missingItems: checked.missingConcepts }
              : {}),
          },
          response
        );
      });
    },
    [
      card.studySettings,
      exercise.cloze,
      exercise.expectedAnswer,
      exercise.mode,
      onSemanticCheck,
      settle,
    ]
  );

  const skip = useCallback(() => {
    settle({ verdict: "incorrect", shape: "short" }, "");
  }, [settle]);

  if (exercise.mode === "multiple-choice" && exercise.mcq) {
    return (
      <div
        data-study-current-card-id={card.id}
        className="mx-auto w-full max-w-[62rem]"
      >
        <StudyMultipleChoice
          prompt={exercise.prompt}
          question={exercise.mcq}
          onAnswered={(correct) => onModeAnswered("multiple-choice", correct)}
          // Picking the answer is the attempt; reading why the others were
          // wrong is not part of it. The rating is settled the moment they
          // choose and committed when they move on, so the explanation can be
          // read for as long as they like without it counting as hesitation.
          onContinue={(correct) =>
            onCommit(correct ? "good" : "again", { requeueOnMiss: true })
          }
        />
      </div>
    );
  }

  const isGapFill = exercise.mode === "gap-fill" && Boolean(exercise.cloze);
  const promptNode = isGapFill ? (
    <div className="space-y-3">
      <StudyText
        as="p"
        text={card.front}
        className="text-center text-sm text-text-muted"
      />
      <StudyText
        as="p"
        text={renderClozePrompt(card.back, exercise.cloze!, BLANK)}
        className="whitespace-pre-wrap text-center text-lg font-medium leading-relaxed text-text-primary sm:text-xl"
      />
    </div>
  ) : (
    <StudyPromptText text={exercise.prompt} />
  );

  // The hint is the first letter and the shape of the word. Enough to unstick a
  // student, never enough to hand them the answer.
  const target = isGapFill ? exercise.cloze!.answer : exercise.expectedAnswer;
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
        onUseHint={() => setHintUsed(true)}
        onSubmit={submit}
        onSkip={skip}
      />

      {reveal ? (
        <div className="space-y-4">
          <div className="space-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-5">
            <div className="text-2xs font-semibold uppercase tracking-[0.2em] text-text-muted">
              {isGapFill ? "The missing word" : "The answer"}
            </div>
            <StudyText
              as="p"
              text={isGapFill ? exercise.cloze!.answer : card.back}
              className="whitespace-pre-wrap text-base leading-relaxed text-text-primary sm:text-lg"
            />

          </div>

          {reveal.rating ? (
            <Button
              type="button"
              size="lg"
              disabled={savingRating !== null}
              onClick={() => onCommit(reveal.rating!, { requeueOnMiss: true })}
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
                scale="four-point"
                savingRating={savingRating}
                onRate={(rating) => onCommit(rating, { requeueOnMiss: true })}
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
    return `${words.length} words, starting with "${words[0]}".`;
  }
  return words
    .map((word) => (word.length > 1 ? `${word[0]}${"·".repeat(word.length - 1)}` : word))
    .join(" ");
}
