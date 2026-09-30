import { getCardStrength, type CardStrength } from "@/lib/study/card-strength";
import type { Card } from "@/lib/study/cards";

/**
 * How well each label of a diagram is known, from its own card.
 *
 * Group cards are left out: a group mixes labels, so its history says nothing
 * about any one of them.
 */
export function getDiagramStrengths(cards: readonly Card[], now = Date.now()) {
  const strengths = new Map<string, CardStrength>();
  for (const card of cards) {
    const labelId = card.occlusion?.labelId;
    if (labelId) strengths.set(labelId, getCardStrength(card, now));
  }
  return strengths;
}
