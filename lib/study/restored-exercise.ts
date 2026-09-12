import type { Card } from "@/lib/study/cards";
import type { PersistedStudyExercise } from "@/lib/study/session";
import { selectClozeGaps } from "@/lib/study/gap-fill";
import { STUDY_ASSET_VALIDATOR_VERSION } from "@/lib/study/study-asset-versions";
import type { ResolvedExercise } from "@/lib/study/study-modes";

export function restoreStudyExercise(restored: PersistedStudyExercise, card: Card): ResolvedExercise {
  return {
    cardId: card.id, presentationId: restored.presentationId,
    cardContentHash: restored.contentHash, mode: restored.mode, prompt: card.front,
    expectedAnswer: restored.gaps?.length ? restored.gaps.map((gap) => gap.answer).join(" · ") : card.back,
    ...(restored.cloze ? { cloze: restored.cloze } : {}),
    ...(restored.gaps ? { gaps: restored.gaps } : {}),
    ...(restored.mcq ? { mcq: { ...restored.mcq, explanations: restored.mcq.explanations ?? {} } } : {}),
    ...(restored.variantId ? { variantId: restored.variantId } : {}),
    ...(restored.markingSettings ? { markingSettings: restored.markingSettings } : {}),
    source: restored.markingSettings?.generatedStudy ? "cached-ai" : restored.markingSettings ? "author" : "deterministic",
  };
}

/** Never silently upgrade an old generated presentation into a validated one. */
export function canRestoreStudyExercise(exercise: PersistedStudyExercise, card: Card): boolean {
  if (exercise.mode === "classic") return true;
  const generated = exercise.markingSettings?.generatedStudy;
  if (generated && (generated.validatorVersion !== STUDY_ASSET_VALIDATOR_VERSION || !generated.bundleRevision ||
    (exercise.variantId && generated.retiredVariantIds?.includes(exercise.variantId)))) return false;
  if (!exercise.markingSettings && (exercise.mode === "gap-fill" || exercise.mode === "multiple-choice")) return false;
  if (!generated && exercise.mode === "multiple-choice" && card.studySettings?.mcqDistractors === undefined) return false;
  if (!generated && exercise.mode === "gap-fill" && card.studySettings?.pinnedGaps === undefined) return false;
  if (exercise.mode === "multiple-choice") {
    const options = exercise.mcq?.options ?? [];
    return options.length === 4 && new Set(options.map((option) => option.id)).size === 4 &&
      new Set(options.map((option) => option.text.trim().toLowerCase())).size === 4 &&
      options.some((option) => option.id === exercise.mcq?.correctOptionId) &&
      (!generated || options.every((option) => Boolean(exercise.mcq?.explanations?.[option.id]?.trim())));
  }
  if (exercise.mode === "gap-fill") {
    const gaps = exercise.gaps ?? [];
    if (!gaps.length) return false;
    // Reuse the same boundaries, density and protected-markup checks as creation.
    const checked = selectClozeGaps({ front: card.front, back: card.back, settings: {
      generatedStudy: { bundleVersion: 3, sourceHash: "snapshot", gapVariants: [{ id: "snapshot", gaps }], mcqVariants: [] },
    } });
    return checked.length === gaps.length && checked.every((gap, index) => gap.id === gaps[index].id);
  }
  return true;
}
