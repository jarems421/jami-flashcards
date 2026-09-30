import type { Card } from "@/lib/study/cards";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import { getDifficultyInfo } from "@/lib/study/scheduler";

/**
 * How well one card is known, in the four words a student reads.
 *
 * A card never reviewed is `new`, never weak: nothing is known about it yet,
 * and calling it weak would be a verdict on no evidence.
 */
export type CardStrength = "new" | "needs-focus" | "building" | "strong";

export type CardStrengthInput = Pick<
  Card,
  | "difficulty"
  | "lapses"
  | "reps"
  | "dueDate"
  | "scheduledDays"
  | "lastReview"
  | "lastStruggleAt"
  | "memoryRiskOverrideDayKey"
>;

/**
 * The colour class for each strength, written out whole so the stylesheet
 * build can see them: a class assembled from parts is one it cannot find.
 */
export const CARD_STRENGTH_TINT_CLASSES: Record<CardStrength, string> = {
  new: "occlusion-tint--new",
  "needs-focus": "occlusion-tint--needs-focus",
  building: "occlusion-tint--building",
  strong: "occlusion-tint--strong",
};

export const CARD_STRENGTH_LABELS: Record<CardStrength, string> = {
  new: "New card",
  "needs-focus": "Needs focus",
  building: "Still building",
  strong: "Looking strong",
};

export function getCardStrength(card: CardStrengthInput, now = Date.now()): CardStrength {
  if ((card.reps ?? 0) === 0) return "new";
  const learning = getDifficultyInfo(card.difficulty).tier;
  const risk = getMemoryRiskInfo(card, now).tier;
  if (risk === "high" || learning === "hard") return "needs-focus";
  if (risk === "medium" || learning === "medium") return "building";
  return "strong";
}
