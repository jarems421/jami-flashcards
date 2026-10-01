import { getCardStrength, type CardStrength } from "@/lib/study/card-strength";
import type { Card } from "@/lib/study/cards";
import { isWholeDiagramGroupId } from "@/lib/study/image-occlusion";

/**
 * How well each label of a diagram is known, from its own card.
 *
 * Group cards are left out: a group mixes labels, so its history says nothing
 * about any one of them. A whole-diagram card is the exception, because it is
 * the only card its labels have: its strength is the diagram's, and every box
 * shows it.
 */
export function getDiagramStrengths(cards: readonly Card[], now = Date.now()) {
  const strengths = new Map<string, CardStrength>();
  for (const card of cards) {
    const labelId = card.occlusion?.labelId;
    if (labelId) strengths.set(labelId, getCardStrength(card, now));
    else if (card.occlusion && isWholeDiagramGroupId(card.occlusion.groupId)) {
      const strength = getCardStrength(card, now);
      for (const label of card.occlusion.diagram.labels) strengths.set(label.id, strength);
    }
  }
  return strengths;
}
