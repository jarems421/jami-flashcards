import type { Card } from "@/lib/study/cards";
import { buildDeterministicExercise, resolveExerciseMode } from "@/lib/study/mode-eligibility";
import type { PersistedStudyExercise } from "@/lib/study/session";
import { getCardContentHash, type ResolvedExercise, type StudyMode, type StudyModePolicy } from "@/lib/study/study-modes";

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
  modeCounts?: Partial<Record<StudyMode, number>>;
  recentModes?: StudyMode[];
  firstExercise?: ResolvedExercise | null;
  presentationId?: string;
  sessionId?: string;
  variantHistory?: Record<string, string[]>;
  outcomeHistory?: Record<string, Array<"correct" | "partial" | "incorrect" | "uncertain">>;
}): PersistedStudyExercise[] {
  const snapshots: PersistedStudyExercise[] = [];
  const counts = { ...(input.modeCounts ?? {}) };
  const recent = [...(input.recentModes ?? [])].slice(-8);
  // Only the displayed presentation is frozen. Future cards are selected when reached.
  input.cards.slice(0, 1).forEach((card, offset) => {
    const context = {
      seed: input.seed,
      presentation: input.index + offset,
      presentationId: input.presentationId ?? `${input.sessionId ?? "session"}:${input.index + offset}:${card.id}`,
      modeCounts: counts,
      recentModes: recent,
      recentVariantIds: input.variantHistory?.[card.id] ?? [],
      recentOutcomes: input.outcomeHistory?.[card.id] ?? [],
    };
    const asked = input.asAsked(card);
    const mode = input.firstExercise?.mode ?? (input.firstExercise === null ? "classic" : resolveExerciseMode(asked, input.modePolicy, input.index + offset, context));
    if (!mode) return;
    const sourceHash = getCardContentHash(card);
    const exercise = offset === 0 && input.firstExercise?.cardId === card.id && input.firstExercise.cardContentHash === sourceHash
      ? input.firstExercise
      : buildDeterministicExercise(asked, mode, sourceHash, context);
    if (!exercise) return;
    snapshots.push({
        ...(exercise.presentationId ? { presentationId: exercise.presentationId } : {}),
        cardId: card.id,
        mode: exercise.mode,
        contentHash: exercise.cardContentHash,
        ...(exercise.cloze ? { cloze: exercise.cloze } : {}),
        ...(exercise.gaps ? { gaps: exercise.gaps } : {}),
        ...(exercise.variantId ? { variantId: exercise.variantId } : {}),
        ...(exercise.markingSettings ? { markingSettings: exercise.markingSettings } : {}),
        ...(exercise.mcq ? { mcq: exercise.mcq } : {}),
      });
    counts[mode] = (counts[mode] ?? 0) + 1;
    recent.push(mode);
    if (recent.length > 8) recent.shift();
  });
  return snapshots;
}
