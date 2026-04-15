import type { Card } from "@/lib/study/cards";
import { getStudyDayKey } from "@/lib/study/day";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_STRUGGLE_WINDOW_MS = 3 * DAY_MS;

export type MemoryRiskTier = "low" | "medium" | "high";

export type MemoryRiskInfo = {
  label: "Low" | "Medium" | "High" | "New";
  tier: MemoryRiskTier;
  score: number;
  reason: string;
};

type MemoryRiskCard = Pick<
  Card,
  | "difficulty"
  | "dueDate"
  | "lapses"
  | "reps"
  | "scheduledDays"
  | "lastReview"
  | "lastStruggleAt"
  | "memoryRiskOverrideDayKey"
>;

function clampRiskScore(score: number) {
  return Math.min(10, Math.max(0, score));
}

export function hasActiveMemoryRiskOverride(
  card: Pick<Card, "memoryRiskOverrideDayKey">,
  now = Date.now()
) {
  return card.memoryRiskOverrideDayKey === getStudyDayKey(now);
}

export function getMemoryRiskInfo(
  card: MemoryRiskCard,
  now = Date.now()
): MemoryRiskInfo {
  const reps = card.reps ?? 0;
  const difficulty = card.difficulty ?? 0;
  const lapses = card.lapses ?? 0;
  const scheduledDays = card.scheduledDays ?? 0;
  const hasOverride = hasActiveMemoryRiskOverride(card, now);
  const hasDueDate = typeof card.dueDate === "number";
  const overdueDays =
    hasDueDate && card.dueDate! < now
      ? Math.max(0, Math.floor((now - card.dueDate!) / DAY_MS))
      : 0;
  const hasUnresolvedRecentStruggle =
    typeof card.lastStruggleAt === "number" &&
    now - card.lastStruggleAt <= RECENT_STRUGGLE_WINDOW_MS &&
    (!(typeof card.lastReview === "number") || card.lastReview < card.lastStruggleAt);

  if (reps === 0 && difficulty <= 0 && !hasOverride && !hasUnresolvedRecentStruggle) {
    return {
      label: "New",
      tier: "medium",
      score: 5,
      reason: "No review signal yet",
    };
  }

  let score = difficulty > 0 ? difficulty : 4.5;
  score += Math.min(3, lapses * 1.2);

  if (scheduledDays > 0 && scheduledDays <= 1) {
    score += 0.8;
  }

  if (overdueDays > 0) {
    score += Math.min(3, 1 + overdueDays * 0.35);
  }

  if (hasUnresolvedRecentStruggle) {
    score = Math.max(score, 7.5);
  }

  if (hasOverride) {
    score = Math.max(score, 8.5);
  }

  const normalizedScore = clampRiskScore(score);

  if (normalizedScore >= 7) {
    return {
      label: "High",
      tier: "high",
      score: normalizedScore,
      reason: hasOverride
        ? "Struggled in Custom Review"
        : lapses > 0
          ? "Struggled more than once"
          : "Needs attention soon",
    };
  }

  if (normalizedScore >= 4) {
    return {
      label: "Medium",
      tier: "medium",
      score: normalizedScore,
      reason: overdueDays > 0 ? "Ready to review" : "Still settling",
    };
  }

  return {
    label: "Low",
    tier: "low",
    score: normalizedScore,
    reason: "Holding well",
  };
}
