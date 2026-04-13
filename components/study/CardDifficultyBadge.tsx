import { getDifficultyInfo } from "@/lib/study/scheduler";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import type { Card } from "@/lib/study/cards";

type Props = {
  card: Pick<
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
};

const TIER_CLASSES = {
  easy: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  hard: "border-rose-500/30 bg-rose-500/10 text-rose-300",
} as const;

const RISK_CLASSES = {
  low: "text-emerald-300",
  medium: "text-amber-300",
  high: "text-rose-300",
} as const;

export default function CardDifficultyBadge({ card }: Props) {
  const difficulty = getDifficultyInfo(card.difficulty);
  const memoryRisk = getMemoryRiskInfo(card);
  const numericDifficulty =
    typeof card.difficulty === "number" && card.difficulty > 0
      ? card.difficulty.toFixed(1)
      : null;
  const reviewCount = card.reps ?? 0;
  const lapses = card.lapses ?? 0;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${TIER_CLASSES[difficulty.tier]}`}
      title={
        numericDifficulty
          ? `FSRS difficulty ${numericDifficulty}/10, memory risk ${memoryRisk.label} (${memoryRisk.reason}), ${reviewCount} review${reviewCount === 1 ? "" : "s"}, ${lapses} lapse${lapses === 1 ? "" : "s"}`
          : "New card with no review history yet"
      }
    >
      FSRS {difficulty.label}
      {numericDifficulty ? (
        <span className="opacity-70">{numericDifficulty}/10</span>
      ) : null}
      <span className={`opacity-90 ${RISK_CLASSES[memoryRisk.tier]}`}>
        Risk {memoryRisk.label}
      </span>
    </span>
  );
}
