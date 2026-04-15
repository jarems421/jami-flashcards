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

function getLearningLabel(label: string) {
  if (label === "Easy") {
    return "Comfortable";
  }

  if (label === "Hard") {
    return "Needs practice";
  }

  if (label === "Medium") {
    return "Getting there";
  }

  return label;
}

function getPriorityLabel(label: string) {
  if (label === "High") {
    return "Review soon";
  }

  if (label === "Medium") {
    return "Keep warm";
  }

  if (label === "Low") {
    return "Comfortable";
  }

  return "New";
}

export default function CardDifficultyBadge({ card }: Props) {
  const difficulty = getDifficultyInfo(card.difficulty);
  const memoryRisk = getMemoryRiskInfo(card);
  const reviewCount = card.reps ?? 0;
  const lapses = card.lapses ?? 0;
  const learningLabel = getLearningLabel(difficulty.label);
  const priorityLabel = getPriorityLabel(memoryRisk.label);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${TIER_CLASSES[difficulty.tier]}`}
      title={
        reviewCount > 0
          ? `${learningLabel}. ${priorityLabel}. Reviewed ${reviewCount} time${reviewCount === 1 ? "" : "s"}${lapses > 0 ? `, struggled ${lapses} time${lapses === 1 ? "" : "s"}` : ""}.`
          : "New card with no review history yet"
      }
    >
      Learning: {learningLabel}
      <span className={`opacity-90 ${RISK_CLASSES[memoryRisk.tier]}`}>
        Priority: {priorityLabel}
      </span>
    </span>
  );
}
