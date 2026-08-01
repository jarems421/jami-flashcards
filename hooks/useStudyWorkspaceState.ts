"use client";

import { useState } from "react";
import type { StarReward } from "@/components/constellation/StarRewardOverlay";
import { getMsUntilNextStudyBoundary } from "@/lib/study/day";
import type { AnswerFeedback } from "@/lib/study/study-feedback";
import type { Card } from "@/lib/study/cards";
import type { CardRating } from "@/lib/study/scheduler";
import type { DailyReviewState } from "@/lib/study/daily-review";
import {
  createEmptySessionStats,
  type StudySessionKind,
  type StudySessionStats,
} from "@/lib/study/session";
import {
  EMPTY_FOCUSED_REVIEW_RECENTS,
  type FocusedReviewRecents,
} from "@/lib/study/focused-review";
import type { Deck } from "@/lib/study/decks";
import type { Topic } from "@/lib/material/topics";

export type StudyFocusedFilterKind = "decks" | "topics";

export function useStudyDataState() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [dailyReviewState, setDailyReviewState] =
    useState<DailyReviewState | null>(null);
  const [loaded, setLoaded] = useState(false);

  return {
    decks,
    setDecks,
    cards,
    setCards,
    topics,
    setTopics,
    dailyReviewState,
    setDailyReviewState,
    loaded,
    setLoaded,
  };
}

export function useFocusedReviewState(options: {
  requestedDeckIds: string[];
  requestedTopicIds: string[];
  hasRequestedLegacyTags: boolean;
  initiallyOpen: boolean;
}) {
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>(
    options.requestedDeckIds
  );
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>(
    options.requestedTopicIds
  );
  const [deckSearch, setDeckSearch] = useState("");
  const [topicSearch, setTopicSearch] = useState("");
  const [focusedReviewOpen, setFocusedReviewOpen] = useState(
    options.initiallyOpen
  );
  const [focusedFilterKind, setFocusedFilterKind] =
    useState<StudyFocusedFilterKind>(
      (options.requestedTopicIds.length > 0 ||
        options.hasRequestedLegacyTags) &&
        options.requestedDeckIds.length === 0
        ? "topics"
        : "decks"
    );
  const [focusedReviewRecents, setFocusedReviewRecents] =
    useState<FocusedReviewRecents>(EMPTY_FOCUSED_REVIEW_RECENTS);

  return {
    selectedDeckIds,
    setSelectedDeckIds,
    selectedTopicIds,
    setSelectedTopicIds,
    deckSearch,
    setDeckSearch,
    topicSearch,
    setTopicSearch,
    focusedReviewOpen,
    setFocusedReviewOpen,
    focusedFilterKind,
    setFocusedFilterKind,
    focusedReviewRecents,
    setFocusedReviewRecents,
  };
}

export function useStudySessionState() {
  const [sessionKind, setSessionKind] = useState<StudySessionKind | null>(null);
  const [sessionCards, setSessionCards] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [jamiAssistantOpen, setJamiAssistantOpen] = useState(false);
  const [savingRating, setSavingRating] = useState<CardRating | null>(null);
  const [sessionStats, setSessionStats] = useState<StudySessionStats>(
    createEmptySessionStats()
  );
  const [answerFeedback, setAnswerFeedback] =
    useState<AnswerFeedback | null>(null);
  const [starReward, setStarReward] = useState<StarReward | null>(null);
  const [countdownMs, setCountdownMs] = useState(
    getMsUntilNextStudyBoundary()
  );
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineSnapshotAt, setOfflineSnapshotAt] = useState<number | null>(
    null
  );
  const [pendingOfflineReviews, setPendingOfflineReviews] = useState(0);
  const [sessionRestoreReady, setSessionRestoreReady] = useState(false);

  return {
    sessionKind,
    setSessionKind,
    sessionCards,
    setSessionCards,
    index,
    setIndex,
    flipped,
    setFlipped,
    jamiAssistantOpen,
    setJamiAssistantOpen,
    savingRating,
    setSavingRating,
    sessionStats,
    setSessionStats,
    answerFeedback,
    setAnswerFeedback,
    starReward,
    setStarReward,
    countdownMs,
    setCountdownMs,
    offlineMode,
    setOfflineMode,
    offlineSnapshotAt,
    setOfflineSnapshotAt,
    pendingOfflineReviews,
    setPendingOfflineReviews,
    sessionRestoreReady,
    setSessionRestoreReady,
  };
}
