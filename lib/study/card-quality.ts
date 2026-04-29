import { getCardContentKey, type Card } from "@/lib/study/cards";

export type CardQualityWarning = {
  id: string;
  label: string;
  detail: string;
  tone: "warm" | "error" | "calm";
};

export function getCardQualityWarnings(
  card: Pick<Card, "front" | "back" | "tags">,
  options: { duplicateCount?: number } = {}
): CardQualityWarning[] {
  const warnings: CardQualityWarning[] = [];
  const front = card.front.trim();
  const back = card.back.trim();

  if (options.duplicateCount && options.duplicateCount > 1) {
    warnings.push({
      id: "duplicate",
      label: "Possible duplicate",
      detail: "Another card has the same prompt and answer.",
      tone: "warm",
    });
  }

  if (front.length > 220) {
    warnings.push({
      id: "long-front",
      label: "Long prompt",
      detail: "Shorter prompts are usually easier to recall.",
      tone: "warm",
    });
  }

  if (back.length > 800) {
    warnings.push({
      id: "long-back",
      label: "Long answer",
      detail: "Consider splitting this into smaller cards.",
      tone: "warm",
    });
  }

  if (back.length > 0 && back.length < 3) {
    warnings.push({
      id: "short-back",
      label: "Very short answer",
      detail: "Check that the answer has enough context.",
      tone: "calm",
    });
  }

  if (front && back && front.toLowerCase() === back.toLowerCase()) {
    warnings.push({
      id: "same-front-back",
      label: "Prompt matches answer",
      detail: "The front and back are identical.",
      tone: "error",
    });
  }

  if (card.tags.length === 0) {
    warnings.push({
      id: "untagged",
      label: "No tags",
      detail: "Tags make focused review easier later.",
      tone: "calm",
    });
  }

  return warnings;
}

export function getCardContentDuplicateCounts(cards: Pick<Card, "front" | "back">[]) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const key = getCardContentKey(card.front, card.back);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
