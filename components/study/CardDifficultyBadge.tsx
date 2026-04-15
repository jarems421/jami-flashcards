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

function getStatusLabel({
  learningTier,
  riskTier,
  reviewCount,
}: {
  learningTier: "easy" | "medium" | "hard";
  riskTier: "low" | "medium" | "high";
  reviewCount: number;
}) {
  if (reviewCount === 0) {
    return "New card";
  }

  if (riskTier === "high") {
    return "Needs focus";
  }

  if (learningTier === "hard") {
    return "Needs practice";
  }

  if (riskTier === "medium" || learningTier === "medium") {
    return "Still building";
  }

  return "Looking strong";
}

export default function CardDifficultyBadge({ card }: Props) {
  const difficulty = getDifficultyInfo(card.difficulty);
  const memoryRisk = getMemoryRiskInfo(card);
  const reviewCount = card.reps ?? 0;
  const lapses = card.lapses ?? 0;
  const statusLabel = getStatusLabel({
    learningTier: difficulty.tier,
    riskTier: memoryRisk.tier,
    reviewCount,
  });

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${TIER_CLASSES[difficulty.tier]}`}
      title={
        reviewCount > 0
          ? `${statusLabel}. Reviewed ${reviewCount} time${reviewCount === 1 ? "" : "s"}${lapses > 0 ? `, struggled ${lapses} time${lapses === 1 ? "" : "s"}` : ""}.`
          : "New card with no review history yet"
      }
    >
      Status: {statusLabel}
    </span>
  );
}
