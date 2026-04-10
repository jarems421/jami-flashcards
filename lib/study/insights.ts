import type { Card } from "@/lib/study/cards";
import { getDailyReviewBucket } from "@/lib/study/daily-review";
import type { WeakArea } from "@/lib/study/weak-points";

export type MemoryStatusTone = "new" | "fragile" | "shaky" | "improving" | "stable";

export type MemoryStatus = {
  label: string;
  tone: MemoryStatusTone;
  description: string;
};

export type LearningInsight = {
  title: string;
  description: string;
  eyebrow: string;
};

type StudyReasonOptions = {
  card: Card;
  sessionKind: "daily-required" | "daily-optional" | "custom";
  selectedDeckIds?: string[];
  selectedTags?: string[];
  now?: number;
};

export function getMemoryStatus(card: Pick<Card, "difficulty" | "lapses" | "reps" | "scheduledDays">): MemoryStatus {
  const difficulty = card.difficulty ?? 0;
  const lapses = card.lapses ?? 0;
  const reps = card.reps ?? 0;
  const scheduledDays = card.scheduledDays ?? 0;

  if (reps === 0) {
    return {
      label: "New",
      tone: "new",
      description: "This card is still building its first memory trace.",
    };
  }

  if (lapses >= 3 || difficulty >= 7 || scheduledDays <= 1) {
    return {
      label: "Fragile",
      tone: "fragile",
      description: "Recall is still unreliable, so the model keeps this memory on a short leash.",
    };
  }

  if (reps >= 6 && difficulty < 4 && lapses === 0 && scheduledDays >= 7) {
    return {
      label: "Stable",
      tone: "stable",
      description: "You have repeated this enough that it is holding up well between reviews.",
    };
  }

  if (reps >= 3 && difficulty < 6 && lapses <= 1) {
    return {
      label: "Improving",
      tone: "improving",
      description: "This memory is strengthening, but it still benefits from a few more clean recalls.",
    };
  }

  return {
    label: "Shaky",
    tone: "shaky",
    description: "The card is partway there, but its recall pattern is still inconsistent.",
  };
}

export function getStudyReason({
  card,
  sessionKind,
  selectedDeckIds = [],
  selectedTags = [],
  now = Date.now(),
}: StudyReasonOptions) {
  if (sessionKind === "daily-optional") {
    return "This card is currently classed as easy, so it stays optional after the required queue is done.";
  }

  if (sessionKind === "custom") {
    const matchesDeck = selectedDeckIds.includes(card.deckId);
    const matchesTag = card.tags.some((tag) => selectedTags.includes(tag));

    if (matchesDeck && matchesTag) {
      return "Included because it matches both your chosen deck and tag filters.";
    }

    if (matchesDeck) {
      return "Included because it belongs to one of the decks you selected for this custom session.";
    }

    if (matchesTag) {
      return "Included because it matches one of the tags you selected, even outside the chosen decks.";
    }

    return "Included by your custom review filters.";
  }

  if ((card.reps ?? 0) === 0) {
    return "This card is still new, so Daily Review uses it to teach the memory model where it should land.";
  }

  if ((card.lapses ?? 0) >= 2) {
    return "You have forgotten this card more than once recently, so it stays in today's required queue.";
  }

  if ((card.dueDate ?? now) < now) {
    return "This card is overdue and at higher forgetting risk, so it needs attention before Custom Review.";
  }

  if (getDailyReviewBucket(card) === "weak") {
    return "Its recent review pattern still looks weak, so it has been pulled into the required part of Daily Review.";
  }

  return "This card is due today and still needs reinforcement before it can move out of the required queue.";
}

export function buildLearningInsights({
  cards,
  requiredCards,
  weakAreas,
}: {
  cards: Card[];
  requiredCards: Card[];
  weakAreas: WeakArea[];
}): LearningInsight[] {
  const insights: LearningInsight[] = [];

  if (cards.length === 0) {
    return [];
  }

  const weakRequiredCount = requiredCards.filter(
    (card) => getDailyReviewBucket(card) === "weak"
  ).length;
  const mediumRequiredCount = requiredCards.length - weakRequiredCount;

  if (requiredCards.length > 0) {
    insights.push({
      eyebrow: "Next step",
      title: `Finish ${requiredCards.length} required card${requiredCards.length === 1 ? "" : "s"}`,
      description:
        weakRequiredCount > 0
          ? `${weakRequiredCount} weak and ${mediumRequiredCount} medium card${mediumRequiredCount === 1 ? "" : "s"} are waiting. Clear these first to unlock Custom Review.`
          : `${mediumRequiredCount} medium card${mediumRequiredCount === 1 ? "" : "s"} are waiting. Clear these first to unlock Custom Review.`,
    });
  } else {
    insights.push({
      eyebrow: "Next step",
      title: "Custom Review is open",
      description:
        "Your required Daily Review is clear, so you can choose any decks or tags and practise freely.",
    });
  }

  const weakestArea = weakAreas[0];
  if (weakestArea) {
    insights.push({
      eyebrow: "Watch this area",
      title: weakestArea.name,
      description: `${weakestArea.cardCount} card${weakestArea.cardCount === 1 ? "" : "s"} here are causing the most friction, with ${weakestArea.totalLapses} recent lapse${weakestArea.totalLapses === 1 ? "" : "s"}.`,
    });
  }

  const stableCards = cards.filter(
    (card) => getMemoryStatus(card).tone === "stable"
  ).length;

  if (requiredCards.length > 0) {
    insights.push({
      eyebrow: "Why daily first",
      title: "Custom Review waits until required is done",
      description:
        "Daily Review handles the cards most likely to slip first. Easy cards stay optional, and custom practice opens after the required queue.",
    });
  } else if (stableCards > 0) {
    insights.push({
      eyebrow: "Progress",
      title: `${stableCards} card${stableCards === 1 ? "" : "s"} are staying stable`,
      description:
        "These cards are holding up well enough to stay out of the required queue for now.",
    });
  }

  return insights.slice(0, 3);
}
