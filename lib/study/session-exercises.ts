import type { Card } from "@/lib/study/cards";
import { buildDeterministicExercise, resolveExerciseMode } from "@/lib/study/mode-eligibility";
import type { PersistedStudyExercise } from "@/lib/study/session";
import { getCardContentHash, type StudyModePolicy } from "@/lib/study/study-modes";

/**
 * The questions still ahead in a session, snapshotted so a resume redraws them.
 *
 * Each exercise carries its own blanks and options, so coming back to a session
 * asks the same question without another read; the content hash lets a card
 * edited in the meantime be rebuilt rather than marked against a stale one.
 *
 * `asAsked` is passed in rather than imported because the merge that folds
 * prepared aliases and distractors into a card lives on the service side, and
 * this module is domain logic that must not reach across that line. It matters
 * that it is applied: built from the raw card, a multiple-choice question finds
 * no prepared distractors, drops itself out of the snapshot, and a resumed
 * session quietly re-asks it a different way.
 */
export function buildSessionExerciseSnapshots(input: {
  cards: Card[];
  asAsked: (card: Card) => Card;
  modePolicy: StudyModePolicy;
  index: number;
  seed: number;
}): PersistedStudyExercise[] {
  return input.cards.flatMap((card) => {
    const context = { seed: input.seed };
    const asked = input.asAsked(card);
    const mode = resolveExerciseMode(asked, input.modePolicy, input.index, context);
    if (!mode) return [];
    const exercise = buildDeterministicExercise(
      asked,
      mode,
      getCardContentHash(asked),
      context
    );
    if (!exercise) return [];
    return [
      {
        cardId: card.id,
        mode: exercise.mode,
        contentHash: exercise.cardContentHash,
        ...(exercise.cloze ? { cloze: exercise.cloze } : {}),
        ...(exercise.mcq ? { mcq: exercise.mcq } : {}),
      },
    ];
  });
}
