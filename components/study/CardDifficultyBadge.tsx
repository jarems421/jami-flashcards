import { getDifficultyInfo } from "@/lib/study/scheduler";
import {
  CARD_STRENGTH_LABELS,
  getCardStrength,
  type CardStrengthInput,
} from "@/lib/study/card-strength";

type Props = {
  card: CardStrengthInput;
  compact?: boolean;
};

const TIER_CLASSES = {
  easy: "app-success",
  medium: "app-warning",
  hard: "app-danger",
} as const;

export default function CardDifficultyBadge({ card, compact = false }: Props) {
  const difficulty = getDifficultyInfo(card.difficulty);
  const reviewCount = card.reps ?? 0;
  const lapses = card.lapses ?? 0;
  const statusLabel = CARD_STRENGTH_LABELS[getCardStrength(card)];

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${
        compact
          ? "px-2.5 py-1 text-2xs"
          : "gap-1.5 px-3 py-1.5 text-xs"
      } ${TIER_CLASSES[difficulty.tier]}`}
      title={
        reviewCount > 0
          ? `${statusLabel}. Reviewed ${reviewCount} time${reviewCount === 1 ? "" : "s"}${lapses > 0 ? `, struggled ${lapses} time${lapses === 1 ? "" : "s"}` : ""}.`
          : "New card with no review history yet"
      }
    >
      {compact ? statusLabel : `Status: ${statusLabel}`}
    </span>
  );
}
