"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { deleteField, doc, increment, updateDoc } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { db } from "@/services/firebase/client";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import { type DailyReviewState } from "@/lib/study/daily-review";
import { getMsUntilNextStudyBoundary, getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import { isStruggleRating, isSuccessfulRating, updateCardSchedule, type CardRating } from "@/lib/study/scheduler";
import { getTagKey, parseCardTagsParam, type Card } from "@/lib/study/cards";
import { ensureDailyReviewState, ensureStudyStateSetup, loadUserCards, markDailyReviewCardComplete, recordDailyReviewWeakAttempt } from "@/services/study/daily-review";
import { applyGoalProgressForAnswer } from "@/services/study/goals";
import { recordStudyReview } from "@/services/study/activity";
import { getDecks, type Deck } from "@/services/study/decks";
import StudyAssistant from "@/components/study/StudyAssistant";
import AppPage from "@/components/layout/AppPage";
import { Button, Card as SurfaceCard, EmptyState, FeedbackBanner, PageHero, ProgressBar, Skeleton } from "@/components/ui";

type SessionKind = "daily-required" | "daily-optional" | "custom";
type SessionStats = { reviewedCards: number; correctAnswers: number; completedGoals: number; starsEarned: number; ratings: Record<CardRating, number>; };
const RATING_LABELS: Record<CardRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
type AnswerFeedback = { tone: "error" | "warm" | "good" | "calm"; message: string };

const RATING_STYLES: Record<CardRating, { hint: string; shortcut: string; classes: string }> = {
  again: {
    hint: "Missed it",
    shortcut: "1",
    classes: "border-rose-300/25 bg-rose-400/[0.08] text-rose-100 hover:border-rose-200/45 hover:bg-rose-400/[0.12]",
  },
  hard: {
    hint: "Barely recalled",
    shortcut: "2",
    classes: "border-amber-300/25 bg-amber-300/[0.08] text-amber-100 hover:border-amber-200/45 hover:bg-amber-300/[0.12]",
  },
  good: {
    hint: "Recalled",
    shortcut: "3",
    classes: "border-sky-200/20 bg-white/[0.045] text-white hover:border-sky-100/38 hover:bg-white/[0.075]",
  },
  easy: {
    hint: "Instant",
    shortcut: "4",
    classes: "border-emerald-300/25 bg-emerald-400/[0.08] text-emerald-100 hover:border-emerald-200/45 hover:bg-emerald-400/[0.12]",
  },
};

function getSessionLabel(kind: SessionKind | null) {
  if (kind === "custom") return "Custom Review";
  if (kind === "daily-optional") return "Optional Daily Review";
  return "Recommended Daily Review";
}

function getAnswerFeedback(rating: CardRating, sessionKind: SessionKind, parked: boolean) {
  if (rating === "again") {
    return {
      tone: "error" as const,
      message: parked
        ? "Marked for tomorrow so you do not get stuck."
        : sessionKind === "daily-required"
          ? "Requeued for another try."
          : "Marked for tomorrow.",
    };
  }

  if (rating === "hard") {
    return {
      tone: "warm" as const,
      message: parked
        ? "Parked for tomorrow after a tough run."
        : sessionKind === "daily-required"
          ? "Requeued once more for practice."
          : "Marked as worth revisiting tomorrow.",
    };
  }

  if (rating === "good") {
    return { tone: "good" as const, message: "Nice recall." };
  }

  return { tone: "good" as const, message: "Easy win." };
}

function InlineStudyFeedback({ feedback }: { feedback: AnswerFeedback | null }) {
  if (!feedback) return null;

  const toneClass =
    feedback.tone === "error"
      ? "border-rose-300/20 bg-rose-400/[0.10] text-rose-100"
      : feedback.tone === "warm"
        ? "border-amber-300/20 bg-amber-300/[0.10] text-amber-100"
        : feedback.tone === "good"
          ? "border-emerald-300/20 bg-emerald-400/[0.10] text-emerald-100"
          : "border-white/[0.12] bg-white/[0.06] text-text-secondary";

  return (
    <div
      className={`mx-auto w-fit rounded-full border px-3.5 py-2 text-sm font-semibold shadow-[0_12px_24px_rgba(8,2,26,0.18)] animate-fade-in ${toneClass}`}
      role="status"
      aria-live="polite"
    >
      {feedback.message}
    </div>
  );
}

function parseDeckIdsParam(value: string | null) {
  if (!value) return [];
  return Array.from(new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean)));
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function createEmptySessionStats(): SessionStats {
  return { reviewedCards: 0, correctAnswers: 0, completedGoals: 0, starsEarned: 0, ratings: { again: 0, hard: 0, good: 0, easy: 0 } };
}

function StudyStatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <SurfaceCard padding="md" className="text-center">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
        {label}
      </div>
      <div className="mt-3 flex min-h-[2rem] items-center justify-center text-xl font-medium leading-none tabular-nums text-white sm:text-2xl">
        {value}
      </div>
      <p className="mx-auto mt-2 max-w-[16rem] text-sm leading-6 text-text-secondary">
        {detail}
      </p>
    </SurfaceCard>
  );
}

function StepLabel({ step, children }: { step: number; children: string }) {
  return (
    <div className="inline-flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-text-muted">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.06] text-[0.68rem] leading-none tabular-nums text-text-secondary">
        {step}
      </span>
      <span>{children}</span>
    </div>
  );
}

function CountPill({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-[7rem] flex-1 items-center justify-between gap-3 rounded-[1.2rem] border border-white/[0.09] bg-white/[0.045] px-3 py-2 sm:flex-none">
      <span className="text-xs leading-5 text-text-muted">{label}</span>
      <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-white/[0.08] px-2 text-sm font-medium leading-none tabular-nums text-white">
        {value}
      </span>
    </div>
  );
}

function getCardsByIds(cards: Card[], ids: string[]) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  return ids.map((id) => cardsById.get(id) ?? null).filter((card): card is Card => card !== null);
}

function buildCustomReviewCards(cards: Card[], selectedDeckIds: string[], selectedTags: string[]) {
  if (selectedDeckIds.length === 0 && selectedTags.length === 0) return cards;
  const selectedDeckIdSet = new Set(selectedDeckIds);
  const selectedTagSet = new Set(selectedTags.map(getTagKey));
  return cards.filter((card) => {
    const matchesDeck = selectedDeckIdSet.size > 0 && selectedDeckIdSet.has(card.deckId);
    const matchesTag =
      selectedTagSet.size > 0 &&
      card.tags.some((tag) => selectedTagSet.has(getTagKey(tag)));
    return matchesDeck || matchesTag;
  });
}

export default function StudyPage() {
  const searchParams = useSearchParams();
  const { user } = useUser();
  const rawMode = searchParams.get("mode");
  const requestedMode =
    rawMode === "custom" || rawMode === "daily" ? rawMode : null;
  const requestedDeckIds = useMemo(() => parseDeckIdsParam(searchParams.get("decks")), [searchParams]);
  const requestedTags = useMemo(() => parseCardTagsParam(searchParams.get("tags")), [searchParams]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [dailyReviewState, setDailyReviewState] = useState<DailyReviewState | null>(null);
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>(requestedDeckIds);
  const [selectedTags, setSelectedTags] = useState<string[]>(requestedTags);
  const [sessionKind, setSessionKind] = useState<SessionKind | null>(null);
  const [sessionCards, setSessionCards] = useState<Card[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [savingRating, setSavingRating] = useState<CardRating | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats>(createEmptySessionStats());
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; message: string } | null>(null);
  const [answerFeedback, setAnswerFeedback] = useState<AnswerFeedback | null>(null);
  const [countdownMs, setCountdownMs] = useState(getMsUntilNextStudyBoundary());
  const [showExplanation, setShowExplanation] = useState(false);
  const flipTimestampRef = useRef(0);
  const autoStartHandledRef = useRef(false);

  useEffect(() => {
    setSelectedDeckIds(requestedDeckIds);
    setSelectedTags(requestedTags);
    setSessionKind(null);
    setSessionCards([]);
    setIndex(0);
    setFlipped(false);
    setShowExplanation(false);
    setAnswerFeedback(null);
    setSessionStats(createEmptySessionStats());
    autoStartHandledRef.current = false;
  }, [requestedDeckIds, requestedTags, requestedMode]);

  useEffect(() => {
    const interval = setInterval(() => setCountdownMs(getMsUntilNextStudyBoundary()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!answerFeedback) return;
    const timeout = window.setTimeout(() => setAnswerFeedback(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [answerFeedback]);

  const loadAll = useCallback(async () => {
    setLoaded(false);
    setFeedback(null);
    try {
      const setupResults = await Promise.allSettled([
        ensureStudyStateSetup(user.uid),
        ensureConstellationSetup(user.uid),
      ]);

      setupResults.forEach((result, index) => {
        if (result.status === "rejected") {
          const label = index === 0 ? "study state" : "constellation";
          console.warn(`Non-blocking ${label} setup failed.`, result.reason);
        }
      });

      const [nextDecks, nextCards] = await Promise.all([getDecks(user.uid), loadUserCards(user.uid)]);
      const sortedCards = [...nextCards].sort((left, right) => right.createdAt - left.createdAt);
      const nextDailyReviewState = await ensureDailyReviewState(user.uid, sortedCards, Date.now());
      setDecks(nextDecks);
      setCards(sortedCards);
      setDailyReviewState(nextDailyReviewState);
    } catch (error) {
      console.error(error);
      setDecks([]);
      setCards([]);
      setDailyReviewState(null);
      setFeedback({ type: "error", message: "Failed to load your study queue." });
    } finally {
      setLoaded(true);
    }
  }, [user.uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const availableTags = useMemo(() => Array.from(new Set(cards.flatMap((card) => card.tags))).sort((left, right) => left.localeCompare(right)), [cards]);
  const requiredDailyCards = useMemo(() => (dailyReviewState ? getCardsByIds(cards, dailyReviewState.requiredCardIds) : []), [cards, dailyReviewState]);
  const optionalDailyCards = useMemo(() => (dailyReviewState ? getCardsByIds(cards, dailyReviewState.optionalCardIds) : []), [cards, dailyReviewState]);
  const remainingRequiredCards = useMemo(() => {
    if (!dailyReviewState) return [];
    const completed = new Set(dailyReviewState.completedRequiredCardIds);
    const parked = new Set(dailyReviewState.parkedRequiredCardIds);
    return requiredDailyCards.filter((card) => !completed.has(card.id) && !parked.has(card.id));
  }, [dailyReviewState, requiredDailyCards]);
  const remainingOptionalCards = useMemo(() => {
    if (!dailyReviewState) return [];
    const completed = new Set(dailyReviewState.completedOptionalCardIds);
    return optionalDailyCards.filter((card) => !completed.has(card.id));
  }, [dailyReviewState, optionalDailyCards]);
  const hasCards = cards.length > 0;
  const hasRecommendedDailyCards = hasCards && remainingRequiredCards.length > 0;
  const customPreviewCards = useMemo(() => buildCustomReviewCards(cards, selectedDeckIds, selectedTags), [cards, selectedDeckIds, selectedTags]);
  const hasCustomFilters = selectedDeckIds.length > 0 || selectedTags.length > 0;
  const customSelectionEmpty = hasCards && customPreviewCards.length === 0;
  const deckNamesById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.name])),
    [decks]
  );

  const startSession = useCallback((kind: SessionKind) => {
    const nextCards = kind === "daily-required" ? remainingRequiredCards : kind === "daily-optional" ? remainingOptionalCards : customPreviewCards;
    setSessionKind(kind);
    setSessionCards(nextCards);
    setSessionStats(createEmptySessionStats());
    setIndex(0);
    setFlipped(false);
    setSavingRating(null);
    setShowExplanation(false);
    setAnswerFeedback(null);
    setFeedback(null);
  }, [customPreviewCards, remainingOptionalCards, remainingRequiredCards]);

  const handleCustomReviewClick = useCallback(() => {
    if (!hasCards) {
      setFeedback({
        type: "error",
        message: "Create at least one card first, then Custom Review will be ready.",
      });
      return;
    }

    if (customPreviewCards.length === 0) {
      setFeedback({
        type: "error",
        message: hasCustomFilters
          ? "No cards match that Custom Review. Clear filters or choose another deck or tag."
          : "Add cards first, then Custom Review will be ready.",
      });
      return;
    }

    startSession("custom");
  }, [customPreviewCards.length, hasCards, hasCustomFilters, startSession]);

  const clearCustomFilters = useCallback(() => {
    setSelectedDeckIds([]);
    setSelectedTags([]);
    setFeedback(null);
  }, []);

  useEffect(() => {
    if (!loaded || autoStartHandledRef.current) return;
    if (requestedMode === "daily") {
      autoStartHandledRef.current = true;
      if (remainingRequiredCards.length > 0) startSession("daily-required");
      return;
    }
    if (requestedMode === "custom" && customPreviewCards.length > 0) {
      autoStartHandledRef.current = true;
      startSession("custom");
      return;
    }
    autoStartHandledRef.current = true;
  }, [customPreviewCards.length, loaded, remainingRequiredCards.length, requestedMode, selectedDeckIds.length, selectedTags.length, startSession]);

  const done = loaded && sessionKind !== null && (sessionCards.length === 0 || index >= sessionCards.length);
  const current = loaded && sessionKind !== null && !done ? sessionCards[index] : null;
  const totalCards = sessionCards.length;
  const currentCardNumber = current ? index + 1 : 0;
  const accuracyPercentage = sessionStats.reviewedCards > 0 ? Math.round((sessionStats.correctAnswers / sessionStats.reviewedCards) * 100) : 0;
  const progressPercent = totalCards > 0 ? Math.round((index / totalCards) * 100) : 0;

  const goNext = () => {
    setIndex((value) => value + 1);
    setFlipped(false);
    setShowExplanation(false);
  };

  const requeueCurrentCard = (nextCard: Card) => {
    setSessionCards((prev) => {
      const before = prev.slice(0, index);
      const after = prev.slice(index + 1);
      return [...before, ...after, nextCard];
    });
    setFlipped(false);
    setShowExplanation(false);
  };

  const handleRating = async (rating: CardRating) => {
    if (!current || !sessionKind) return;
    setSavingRating(rating);
    setFeedback(null);
    try {
      const now = Date.now();
      const isCorrect = isSuccessfulRating(rating);
      const isStruggle = isStruggleRating(rating);
      const schedule = sessionKind === "custom" ? null : updateCardSchedule(current, rating);
      const cardUpdates: Record<string, unknown> = {};
      if (schedule) {
        Object.assign(cardUpdates, schedule);
        if (isCorrect) {
          cardUpdates.memoryRiskOverrideDayKey = deleteField();
        }
      } else if (isStruggle) {
        const studyDayKey = getStudyDayKey(now);
        cardUpdates.lastStruggleAt = now;
        cardUpdates.lastStruggleStudyDayKey = studyDayKey;
        cardUpdates.memoryRiskOverrideDayKey = shiftStudyDayKey(studyDayKey, 1);
        cardUpdates.customStruggleCount = increment(1);
      }

      const reviewPromise = recordStudyReview(user.uid, now, {
        isCorrect,
        durationMs: flipTimestampRef.current > 0 ? now - flipTimestampRef.current : undefined,
        sessionKind: sessionKind === "custom" ? "custom" : "daily",
      });
      const goalProgressPromise = applyGoalProgressForAnswer(user.uid, isCorrect, now);
      const remainingPromises: Promise<unknown>[] = [];
      if (Object.keys(cardUpdates).length > 0) remainingPromises.push(updateDoc(doc(db, "cards", current.id), cardUpdates));
      let retryResultPromise: Promise<{ attemptCount: number; parked: boolean }> | null = null;
      if (sessionKind === "daily-required" && isStruggle) {
        retryResultPromise = recordDailyReviewWeakAttempt(user.uid, current.id, now);
        remainingPromises.push(retryResultPromise);
      } else if (sessionKind === "daily-required") {
        remainingPromises.push(markDailyReviewCardComplete(user.uid, current.id, "required"));
      }
      if (sessionKind === "daily-optional") remainingPromises.push(markDailyReviewCardComplete(user.uid, current.id, "optional"));
      const [, goalProgress] = await Promise.all([reviewPromise, goalProgressPromise, ...remainingPromises]);
      const retryResult = retryResultPromise ? await retryResultPromise : null;
      const parkedRiskUpdates =
        sessionKind === "daily-required" && isStruggle && retryResult?.parked
          ? {
              lastStruggleAt: now,
              lastStruggleStudyDayKey: getStudyDayKey(now),
              memoryRiskOverrideDayKey: shiftStudyDayKey(getStudyDayKey(now), 1),
            }
          : null;
      if (parkedRiskUpdates) {
        await updateDoc(doc(db, "cards", current.id), parkedRiskUpdates);
      }
      const nextCard: Card = {
        ...current,
        ...(schedule ?? {}),
        ...(parkedRiskUpdates ?? {}),
        ...(sessionKind === "custom" && isStruggle
          ? {
              lastStruggleAt: now,
              lastStruggleStudyDayKey: getStudyDayKey(now),
              memoryRiskOverrideDayKey: shiftStudyDayKey(getStudyDayKey(now), 1),
              customStruggleCount: (current.customStruggleCount ?? 0) + 1,
            }
          : {}),
        ...(schedule && isCorrect ? { memoryRiskOverrideDayKey: undefined } : {}),
      };
      if (schedule || (sessionKind === "custom" && isStruggle)) {
        setCards((prev) => prev.map((card) => (card.id === current.id ? nextCard : card)));
      }
      if (sessionKind === "daily-required") {
        if (isStruggle && retryResult) {
          setDailyReviewState((prev) => prev ? {
            ...prev,
            requiredRetryCounts: { ...prev.requiredRetryCounts, [current.id]: retryResult.attemptCount },
            parkedRequiredCardIds: retryResult.parked && !prev.parkedRequiredCardIds.includes(current.id) ? [...prev.parkedRequiredCardIds, current.id] : prev.parkedRequiredCardIds,
            updatedAt: now,
          } : prev);
        } else {
          setDailyReviewState((prev) => prev ? { ...prev, completedRequiredCardIds: prev.completedRequiredCardIds.includes(current.id) ? prev.completedRequiredCardIds : [...prev.completedRequiredCardIds, current.id], updatedAt: now } : prev);
        }
      } else if (sessionKind === "daily-optional") {
        setDailyReviewState((prev) => prev ? { ...prev, completedOptionalCardIds: prev.completedOptionalCardIds.includes(current.id) ? prev.completedOptionalCardIds : [...prev.completedOptionalCardIds, current.id], updatedAt: now } : prev);
      }
      setSessionStats((prev) => ({ reviewedCards: prev.reviewedCards + 1, correctAnswers: prev.correctAnswers + (isCorrect ? 1 : 0), completedGoals: prev.completedGoals + goalProgress.completedGoals, starsEarned: prev.starsEarned + goalProgress.starsEarned, ratings: { ...prev.ratings, [rating]: prev.ratings[rating] + 1 } }));
      setAnswerFeedback(getAnswerFeedback(rating, sessionKind, Boolean(retryResult?.parked)));
      if (sessionKind === "daily-required" && isStruggle && retryResult && !retryResult.parked) {
        requeueCurrentCard(nextCard);
      } else if (isStruggle && sessionKind !== "daily-required") {
        setShowExplanation(true);
      } else {
        goNext();
      }
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to save that answer. Please try again." });
    } finally {
      setSavingRating(null);
    }
  };

  const handleFlip = useCallback(() => {
    if (!current || flipped) return;
    flipTimestampRef.current = Date.now();
    setFlipped(true);
  }, [current, flipped]);

  const handleRatingRef = useRef(handleRating);
  useEffect(() => {
    handleRatingRef.current = handleRating;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!flipped && current) handleFlip();
        return;
      }
      if (!flipped || savingRating !== null || !current) return;
      const ratingMap: Record<string, CardRating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
      const mappedRating = ratingMap[event.key];
      if (mappedRating) {
        event.preventDefault();
        void handleRatingRef.current(mappedRating);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, flipped, handleFlip, savingRating]);

  const exitSession = () => {
    setSessionKind(null);
    setSessionCards([]);
    setSessionStats(createEmptySessionStats());
    setIndex(0);
    setFlipped(false);
    setSavingRating(null);
    setShowExplanation(false);
    setAnswerFeedback(null);
  };

  return (
    <AppPage title="Study" backHref="/dashboard" backLabel="Dashboard" width="study" contentClassName="space-y-4 sm:space-y-6">
      {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}
      {!loaded ? (
        <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-72" /></div>
      ) : (
        <>
          {sessionKind === null ? (
            <>
              <PageHero
                eyebrow="Study"
                title={
                  remainingRequiredCards.length > 0
                    ? "Recommended review is ready."
                    : hasCards
                      ? "Choose your study path."
                      : "Start with your first cards."
                }
                description={
                  remainingRequiredCards.length > 0
                    ? "Daily Review uses your memory signals to protect the cards most likely to slip. Custom Review is still open when you need focused exam practice."
                    : hasCards
                      ? "Daily Review is clear. Use optional easy cards or build your own Custom Review."
                      : "Add a few cards first, then Daily Review and Custom Review will be ready."
                }
                aside={
                  <div className="rounded-[1.5rem] border border-white/[0.09] bg-white/[0.045] px-4 py-3 text-center text-sm text-text-secondary">
                    <div className="text-xs text-text-muted">Next reset</div>
                    <div className="mt-1 flex min-h-6 items-center justify-center text-base font-medium leading-none tabular-nums text-white">
                      {formatCountdown(countdownMs)}
                    </div>
                  </div>
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <StudyStatCard
                  label="Daily Review"
                  value={remainingRequiredCards.length + remainingOptionalCards.length}
                  detail={`${remainingRequiredCards.length} priority, ${remainingOptionalCards.length} maintenance`}
                />
                <StudyStatCard
                  label="Custom Review"
                  value={!hasCards ? "Set up" : "Open"}
                  detail={!hasCards ? "Create cards first" : `${customPreviewCards.length} cards ready`}
                />
              </div>
              {!hasCards ? (
                <EmptyState
                  emoji="Cards"
                  eyebrow="Start here"
                  title="Create a few cards first"
                  description="There is nothing to review yet, which is completely fine. Add your first flashcards and Jami will build the right study queue from them."
                  action={<Link href="/dashboard/cards" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast hover:bg-accent-hover">Create cards</Link>}
                  secondaryAction={<Link href="/dashboard/decks" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]">Open decks</Link>}
                />
              ) : null}
              {hasCards ? (
                <div className="grid gap-3">
                  <SurfaceCard padding="md" className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <StepLabel step={1}>Daily Review</StepLabel>
                        <h3 className="mt-3 text-lg font-semibold leading-tight text-white">
                          {remainingRequiredCards.length + remainingOptionalCards.length > 0
                            ? `${remainingRequiredCards.length + remainingOptionalCards.length} cards available`
                            : "Daily Review complete"}
                        </h3>
                      </div>
                      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                        <CountPill value={remainingRequiredCards.length} label="Priority" />
                        <CountPill value={remainingOptionalCards.length} label="Maintenance" />
                      </div>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-text-secondary">
                      {remainingRequiredCards.length > 0 && remainingOptionalCards.length > 0
                        ? "Start with Priority Review first, then use Maintenance Review for extra reps if you want more practice."
                        : remainingRequiredCards.length > 0
                          ? "Start with Priority Review cards ranked by your memory signals."
                          : remainingOptionalCards.length > 0
                            ? "Priority Review is clear. Maintenance Review cards are still available for light extra practice."
                            : "No Daily Review cards right now. Custom Review is open whenever you want focused practice."}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Button type="button" onClick={() => startSession("daily-required")} disabled={remainingRequiredCards.length === 0} variant="warm" size="md" className="w-full justify-center">
                          {remainingRequiredCards.length > 0 ? "Priority Review" : "No priority cards"}
                        </Button>
                        <div className="text-center text-xs leading-5 text-text-muted">The cards you&apos;ve been struggling with</div>
                      </div>
                      <div className="space-y-1.5">
                        <Button type="button" onClick={() => startSession("daily-optional")} disabled={remainingOptionalCards.length === 0} variant="secondary" size="md" className="w-full justify-center">
                          {remainingOptionalCards.length > 0 ? "Maintenance Review" : "No maintenance cards"}
                        </Button>
                        <div className="text-center text-xs leading-5 text-text-muted">The cards you&apos;ve been recalling well</div>
                      </div>
                    </div>
                  </SurfaceCard>
                </div>
              ) : null}
              {hasCards ? (
                <SurfaceCard padding="lg" className="relative space-y-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="max-w-2xl">
                      <StepLabel step={2}>Custom Review</StepLabel>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight text-white sm:text-xl">
                        Build your own session
                      </h3>
                      <p className="mt-2 text-sm leading-7 text-text-secondary sm:text-base">
                        Pick decks, tags, or both. Matching is flexible, so selected decks and selected tags are combined.
                      </p>
                    </div>
                    <Button type="button" onClick={handleCustomReviewClick} disabled={customPreviewCards.length === 0} size="lg" className="w-full sm:w-auto">
                      Start custom review
                    </Button>
                  </div>
                  {hasRecommendedDailyCards ? (
                    <div className="flex w-full items-center gap-3 rounded-[1.4rem] border border-warm-border bg-warm-glow px-4 py-3 text-left text-sm text-warm-accent">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] border border-white/20 bg-[linear-gradient(180deg,#fff8fd,#ffdff4)] text-[#10091d]">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
                          <path d="M12 3v3" />
                          <path d="M12 18v3" />
                          <path d="m4.9 4.9 2.1 2.1" />
                          <path d="m17 17 2.1 2.1" />
                          <path d="M3 12h3" />
                          <path d="M18 12h3" />
                          <path d="m4.9 19.1 2.1-2.1" />
                          <path d="m17 7 2.1-2.1" />
                          <circle cx="12" cy="12" r="2.5" />
                        </svg>
                      </span>
                      <span>
                        <span className="block text-sm font-medium text-white">Daily Review is recommended today.</span>
                        <span className="mt-0.5 block text-text-secondary">Custom Review stays open for exam practice. Struggles here still help tomorrow&apos;s memory ranking.</span>
                      </span>
                    </div>
                  ) : null}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-3 text-sm font-medium text-white">Choose decks</div>
                      <div className="flex flex-wrap gap-2">
                        {decks.map((deck) => {
                          const selected = selectedDeckIds.includes(deck.id);
                          return (
                            <button
                              key={deck.id}
                              type="button"
                              className={`rounded-full border px-3 py-2 text-left text-sm transition duration-fast ${selected ? "border-accent bg-accent/20 text-accent" : "border-border bg-white/[0.04] text-white hover:border-border-strong hover:bg-white/[0.07]"}`}
                              onClick={() => {
                                setSelectedDeckIds((prev) => prev.includes(deck.id) ? prev.filter((currentId) => currentId !== deck.id) : [...prev, deck.id]);
                              }}
                            >
                              {deck.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="mb-3 text-sm font-medium text-white">Choose tags</div>
                      <div className="flex flex-wrap gap-2">
                        {availableTags.map((tag) => {
                          const selected = selectedTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              className={`rounded-full border px-3 py-2 text-left text-sm transition duration-fast ${selected ? "border-accent bg-accent/20 text-accent" : "border-border bg-white/[0.04] text-white hover:border-border-strong hover:bg-white/[0.07]"}`}
                              onClick={() => {
                                setSelectedTags((prev) => prev.includes(tag) ? prev.filter((currentTag) => currentTag !== tag) : [...prev, tag]);
                              }}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  {customSelectionEmpty ? (
                    <EmptyState
                      variant="compact"
                      align="left"
                      emoji="Search"
                      title="No cards match this Custom Review"
                      description={hasCustomFilters ? "Your selected decks and tags do not currently match any cards. Clear the filters or pick a different combination." : "There are no cards available for Custom Review yet."}
                      action={hasCustomFilters ? <Button type="button" variant="secondary" onClick={clearCustomFilters}>Clear filters</Button> : undefined}
                      secondaryAction={<Link href="/dashboard/cards" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]">Manage cards</Link>}
                    />
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-sm text-text-secondary">
                    <span className="inline-flex items-center gap-2">
                      <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-white/[0.08] px-2 text-xs font-semibold leading-none tabular-nums text-white">
                        {customPreviewCards.length}
                      </span>
                      <span>card{customPreviewCards.length === 1 ? "" : "s"} selected</span>
                    </span>
                    {hasRecommendedDailyCards ? (
                      <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-medium text-warm-accent">Daily Review recommended</span>
                    ) : null}
                  </div>
                </SurfaceCard>
              ) : null}
            </>
          ) : null}
          {sessionKind === null ? null : done ? (
            totalCards === 0 ? (
              <EmptyState
                emoji="Review"
                eyebrow="Nothing to study"
                title="No cards in this session"
                description={sessionKind === "daily-required" ? "Your recommended Daily Review is clear right now." : sessionKind === "daily-optional" ? "There are no optional easy cards left right now." : "This Custom Review does not match any cards yet."}
                helperText="That is not a bug, it just means this queue is empty for the current selection."
                action={<Button type="button" onClick={exitSession}>Back to study modes</Button>}
                secondaryAction={sessionKind === "custom" ? <Link href="/dashboard/cards" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]">Manage cards</Link> : undefined}
              />
            ) : (
              <SurfaceCard tone="warm" padding="lg" className="animate-warm-glow-pulse">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">Session complete</div>
                    <h2 className="mt-3 text-xl font-medium leading-tight tracking-tight text-white sm:text-2xl">Good work.</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                      You reviewed {sessionStats.reviewedCards} of {totalCards} card{totalCards === 1 ? "" : "s"}. Your next best step is ready below.
                    </p>
                  </div>
                  <div className="rounded-[1.4rem] border border-white/[0.12] bg-white/[0.08] px-4 py-3 text-sm text-text-secondary">
                    <span className="text-sm font-semibold text-white">{accuracyPercentage}%</span> accuracy
                  </div>
                </div>
                <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-center text-sm">
                    <div className="text-xs text-text-muted">Reviewed</div>
                    <div className="mt-2 flex min-h-7 items-center justify-center text-lg font-semibold leading-none tabular-nums text-white">{sessionStats.reviewedCards}</div>
                  </div>
                  <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm">
                    <div className="text-center text-xs text-text-muted">Ratings</div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-text-secondary">
                      {(["again", "hard", "good", "easy"] as CardRating[]).map((rating) => (
                        <span key={rating} className="inline-flex items-center justify-between gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1">
                          <span>{RATING_LABELS[rating]}</span>
                          <span className="font-semibold tabular-nums text-white">{sessionStats.ratings[rating]}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-center text-sm">
                    <div className="text-xs text-text-muted">Goals completed</div>
                    <div className="mt-2 flex min-h-7 items-center justify-center text-lg font-semibold leading-none tabular-nums text-white">{sessionStats.completedGoals}</div>
                  </div>
                  <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-center text-sm">
                    <div className="text-xs text-text-muted">Rewards</div>
                    <div className="mt-2 text-sm text-text-secondary"><span className="font-semibold tabular-nums text-white">{sessionStats.starsEarned}</span> star{sessionStats.starsEarned === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <div className="mt-6 rounded-[1.6rem] border border-white/[0.10] bg-white/[0.06] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Next best step</div>
                  <div className="mt-2 text-base font-semibold text-white sm:text-lg">
                    {sessionKind === "daily-required" && remainingOptionalCards.length > 0
                      ? "Optional easy cards are ready"
                      : hasCards && customPreviewCards.length > 0
                        ? "Custom Review is open"
                        : sessionStats.completedGoals > 0
                          ? "Check your new star"
                          : "Keep your cards tidy"}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-text-secondary">
                    {sessionKind === "daily-required" && remainingOptionalCards.length > 0
                      ? "These are extra practice cards. They are optional, so do them only if you want a little more today."
                      : hasCards && customPreviewCards.length > 0
                        ? "Build a focused session from any decks or tags whenever you want targeted practice."
                        : sessionStats.completedGoals > 0
                          ? "Goal rewards become stars in your constellation."
                          : "Review is done for now. Add, fix, or tidy cards whenever something feels off."}
                  </p>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  {sessionKind === "daily-required" && remainingOptionalCards.length > 0 ? (
                    <Button type="button" onClick={() => startSession("daily-optional")} size="lg" variant="warm">Do optional easy</Button>
                  ) : hasCards && customPreviewCards.length > 0 ? (
                    <Button type="button" onClick={() => startSession("custom")} size="lg" variant="warm">Start custom review</Button>
                  ) : sessionStats.completedGoals > 0 ? (
                    <Link href="/dashboard/constellation" className="inline-flex min-h-[3.25rem] items-center justify-center rounded-[2rem] border border-white/24 bg-[linear-gradient(180deg,#fff8fd_0%,#ffe8f7_42%,#ffdff4_100%)] px-5 py-3 text-base font-medium text-[#10091d] shadow-[0_12px_24px_rgba(255,214,246,0.18)] transition duration-fast hover:-translate-y-[1px] hover:brightness-105">View constellation</Link>
                  ) : (
                    <Link href="/dashboard/cards" className="inline-flex min-h-[3.25rem] items-center justify-center rounded-[2rem] border border-white/24 bg-[linear-gradient(180deg,#fff8fd_0%,#ffe8f7_42%,#ffdff4_100%)] px-5 py-3 text-base font-medium text-[#10091d] shadow-[0_12px_24px_rgba(255,214,246,0.18)] transition duration-fast hover:-translate-y-[1px] hover:brightness-105">Manage cards</Link>
                  )}
                  <Button type="button" onClick={() => startSession(sessionKind)} size="lg" variant="secondary">Study again</Button>
                  <Button type="button" onClick={exitSession} variant="secondary" size="lg">Back to study modes</Button>
                </div>
              </SurfaceCard>
            )
          ) : current ? (
            <div key={current.id} className="animate-slide-up space-y-4 sm:space-y-5">
              <InlineStudyFeedback feedback={answerFeedback} />
              <SurfaceCard padding="lg" className="overflow-hidden">
                <div className="space-y-5">
                  <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div className="min-w-0">
                      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-text-muted">{getSessionLabel(sessionKind)}</div>
                      <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.05] px-3 py-1.5 text-sm leading-none text-text-secondary">
                        <span className="font-semibold tabular-nums text-white">{currentCardNumber}</span>
                        <span className="text-text-muted">/</span>
                        <span className="tabular-nums">{totalCards}</span>
                        <span>cards</span>
                      </div>
                    </div>
                    <div className="min-w-0 lg:min-w-[12rem]">
                      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-text-muted">
                        <span>Progress</span>
                        <span className="tabular-nums">{progressPercent}%</span>
                      </div>
                      <ProgressBar progress={progressPercent} />
                    </div>
                  </div>
                  <div className="mx-auto w-full max-w-[62rem] perspective-[1400px]" onClick={!flipped ? handleFlip : undefined} onKeyDown={(event) => { if (flipped) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleFlip(); } }} role="button" tabIndex={0} aria-label={flipped ? "Flashcard answer shown" : "Flip flashcard"}>
                    <div className={`relative aspect-[5/4] w-full transition-transform duration-slow ease-standard [transform-style:preserve-3d] sm:aspect-[16/10] xl:aspect-[16/9] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}>
                      <div className="absolute inset-0 flex flex-col rounded-[2rem] border border-white/[0.08] bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.08),transparent_34%),linear-gradient(180deg,rgba(31,22,54,0.96),rgba(15,10,30,0.96))] p-5 shadow-[0_18px_44px_rgba(8,2,26,0.24)] [backface-visibility:hidden] sm:p-8 lg:p-10">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 text-xs font-medium text-text-muted">
                            {deckNamesById[current.deckId] ?? "Flashcard"}
                          </div>
                          {current.tags.length > 0 ? (
                            <div className="flex max-w-[60%] flex-wrap justify-end gap-1.5">
                              {current.tags.slice(0, 2).map((tag) => (
                                <span key={tag} className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] font-medium text-text-secondary">{tag}</span>
                              ))}
                              {current.tags.length > 2 ? (
                                <span className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] font-medium text-text-muted">+{current.tags.length - 2}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-1 items-center justify-center py-6">
                          <p className="max-w-4xl text-center text-lg font-medium leading-snug tracking-[0.01em] sm:text-2xl xl:text-[2.15rem]">{current.front}</p>
                        </div>
                        <div className="text-center text-xs font-medium text-text-muted">Tap card or press Space to reveal</div>
                      </div>
                      <div className="absolute inset-0 flex flex-col rounded-[2rem] border border-white/[0.12] bg-[radial-gradient(circle_at_50%_18%,rgba(255,199,234,0.09),transparent_36%),linear-gradient(180deg,rgba(35,25,62,0.98),rgba(17,11,34,0.98))] p-5 shadow-[0_18px_44px_rgba(8,2,26,0.24)] [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8 lg:p-10">
                        <div className="text-xs font-normal tracking-[0.06em] text-text-muted">Answer</div>
                        <div className="flex flex-1 items-center justify-center py-6">
                          <p className="max-w-4xl whitespace-pre-wrap text-center text-lg font-medium leading-snug tracking-[0.01em] text-white sm:text-2xl xl:text-[2.15rem]">{current.back}</p>
                        </div>
                        <div className="text-center text-xs font-medium text-text-muted">How well did you recall this?</div>
                      </div>
                    </div>
                  </div>
                </div>
              </SurfaceCard>
              {!flipped ? (
                <div className="animate-fade-in space-y-3">
                  <StudyAssistant
                    card={current}
                    autoExplain={false}
                    mode="clue"
                    deckName={deckNamesById[current.deckId]}
                    onContinue={goNext}
                  />
                </div>
              ) : null}
              {flipped ? (
                <div className="animate-fade-in space-y-3">
                  {savingRating ? <div className="text-center text-sm text-text-muted">Saving...</div> : null}
                  {showExplanation ? (
                    <StudyAssistant card={current} autoExplain mode="review" deckName={deckNamesById[current.deckId]} onContinue={goNext} />
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-2 sm:grid-cols-4 sm:gap-3">
                        {(["again", "hard", "good", "easy"] as CardRating[]).map((rating) => {
                          const meta = RATING_STYLES[rating];
                          return (
                          <button
                            key={rating}
                            type="button"
                            disabled={savingRating !== null}
                            className={`flex min-h-[4.35rem] flex-col items-center justify-center gap-1.5 rounded-[1.35rem] border px-4 py-3.5 text-center text-sm font-medium shadow-[0_10px_20px_rgba(8,2,26,0.12)] transition duration-fast ease-spring hover:-translate-y-[0.5px] active:scale-[0.985] disabled:opacity-50 ${meta.classes}`}
                            onClick={() => void handleRating(rating)}
                          >
                            <span>{RATING_LABELS[rating]}</span>
                            <span className="text-[0.7rem] font-normal opacity-75">{meta.hint}</span>
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-white/10 bg-black/10 px-2 text-[0.68rem] leading-none tabular-nums opacity-75">{meta.shortcut}</span>
                          </button>
                          );
                        })}
                      </div>
                      <StudyAssistant card={current} autoExplain={false} mode="review" deckName={deckNamesById[current.deckId]} onContinue={goNext} />
                    </div>
                  )}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={exitSession} variant="secondary">Exit session</Button>
                <Link href="/dashboard/cards" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]">Manage cards</Link>
              </div>
            </div>
          ) : null}
        </>
      )}
    </AppPage>
  );
}
