"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { deleteField, doc, increment, updateDoc } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { db } from "@/services/firebase/client";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import { isDailyReviewRequiredComplete, type DailyReviewState } from "@/lib/study/daily-review";
import { getMsUntilNextStudyBoundary, getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import { isStruggleRating, isSuccessfulRating, updateCardSchedule, type CardRating } from "@/lib/study/scheduler";
import { parseCardTagsParam, type Card } from "@/lib/study/cards";
import { ensureDailyReviewState, ensureStudyStateSetup, loadUserCards, markDailyReviewCardComplete, recordDailyReviewWeakAttempt } from "@/services/study/daily-review";
import { applyGoalProgressForAnswer } from "@/services/study/goals";
import { recordStudyReview } from "@/services/study/activity";
import { getDecks, type Deck } from "@/services/study/decks";
import StudyAssistant from "@/components/study/StudyAssistant";
import AppPage from "@/components/layout/AppPage";
import { Button, Card as SurfaceCard, EmptyState, FeedbackBanner, ProgressBar, Skeleton } from "@/components/ui";

type SessionKind = "daily-required" | "daily-optional" | "custom";
type SessionStats = { reviewedCards: number; correctAnswers: number; completedGoals: number; starsEarned: number; ratings: Record<CardRating, number>; };
const RATING_LABELS: Record<CardRating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

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

function getCardsByIds(cards: Card[], ids: string[]) {
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  return ids.map((id) => cardsById.get(id) ?? null).filter((card): card is Card => card !== null);
}

function buildCustomReviewCards(cards: Card[], selectedDeckIds: string[], selectedTags: string[]) {
  if (selectedDeckIds.length === 0 && selectedTags.length === 0) return [];
  const selectedDeckIdSet = new Set(selectedDeckIds);
  const selectedTagSet = new Set(selectedTags);
  return cards.filter((card) => {
    const matchesDeck = selectedDeckIdSet.size > 0 && selectedDeckIdSet.has(card.deckId);
    const matchesTag = selectedTagSet.size > 0 && card.tags.some((tag) => selectedTagSet.has(tag));
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
  const [countdownMs, setCountdownMs] = useState(getMsUntilNextStudyBoundary());
  const [showExplanation, setShowExplanation] = useState(false);
  const flipTimestampRef = useRef(0);
  const explanationCache = useRef<Map<string, string>>(new Map());
  const autoStartHandledRef = useRef(false);

  useEffect(() => {
    setSelectedDeckIds(requestedDeckIds);
    setSelectedTags(requestedTags);
    setSessionKind(null);
    setSessionCards([]);
    setIndex(0);
    setFlipped(false);
    setShowExplanation(false);
    setSessionStats(createEmptySessionStats());
    autoStartHandledRef.current = false;
  }, [requestedDeckIds, requestedTags, requestedMode]);

  useEffect(() => {
    const interval = setInterval(() => setCountdownMs(getMsUntilNextStudyBoundary()), 1000);
    return () => clearInterval(interval);
  }, []);

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
  const customUnlocked = useMemo(() => {
    if (!dailyReviewState) {
      return remainingRequiredCards.length === 0;
    }

    if (dailyReviewState.requiredCardIds.length === 0) {
      return true;
    }

    return isDailyReviewRequiredComplete(dailyReviewState);
  }, [dailyReviewState, remainingRequiredCards.length]);
  const customPreviewCards = useMemo(() => buildCustomReviewCards(cards, selectedDeckIds, selectedTags), [cards, selectedDeckIds, selectedTags]);
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
    setFeedback(null);
  }, [customPreviewCards, remainingOptionalCards, remainingRequiredCards]);

  const handleCustomReviewClick = useCallback(() => {
    if (!customUnlocked) {
      setFeedback({
        type: "error",
        message: "Complete your required Daily Review first to unlock Custom Review.",
      });
      return;
    }

    if (customPreviewCards.length === 0) {
      setFeedback({
        type: "error",
        message: "Choose at least one deck or tag to start Custom Review.",
      });
      return;
    }

    startSession("custom");
  }, [customPreviewCards.length, customUnlocked, startSession]);

  useEffect(() => {
    if (!loaded || autoStartHandledRef.current) return;
    if (requestedMode === "daily") {
      autoStartHandledRef.current = true;
      if (remainingRequiredCards.length > 0) startSession("daily-required");
      return;
    }
    if (
      requestedMode === "custom" &&
      customUnlocked &&
      customPreviewCards.length > 0 &&
      (selectedDeckIds.length > 0 || selectedTags.length > 0)
    ) {
      autoStartHandledRef.current = true;
      startSession("custom");
      return;
    }
    autoStartHandledRef.current = true;
  }, [customPreviewCards.length, customUnlocked, loaded, remainingRequiredCards.length, requestedMode, selectedDeckIds.length, selectedTags.length, startSession]);

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
  };

  return (
    <AppPage title="Study" backHref="/dashboard" backLabel="Dashboard" width="study" contentClassName="space-y-6">
      {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}
      {!loaded ? (
        <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-72" /></div>
      ) : (
        <>
          {sessionKind === null ? (
            <>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_320px]">
                <SurfaceCard tone="warm" padding="lg">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">Daily review</div>
                  <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Daily first.</h2>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">Clear required cards to unlock Custom Review. Easy cards are optional.</p>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm"><div className="text-xs text-text-muted">Required remaining</div><div className="mt-2 text-3xl font-semibold">{remainingRequiredCards.length}</div></div>
                    <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm"><div className="text-xs text-text-muted">Optional easy remaining</div><div className="mt-2 text-3xl font-semibold">{remainingOptionalCards.length}</div></div>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Button type="button" onClick={() => startSession("daily-required")} disabled={remainingRequiredCards.length === 0} variant="warm" size="lg">{remainingRequiredCards.length > 0 ? "Start required" : "Required complete"}</Button>
                    <Button type="button" onClick={() => startSession("daily-optional")} disabled={!customUnlocked || remainingOptionalCards.length === 0} variant="secondary" size="lg">Optional easy</Button>
                  </div>
                </SurfaceCard>
                <SurfaceCard padding="md">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">Study day</div>
                  <div className="mt-4 grid gap-4">
                    <div><div className="text-xs text-text-muted">Next reset</div><div className="mt-1 text-2xl font-semibold">{formatCountdown(countdownMs)}</div></div>
                    <div><div className="text-xs text-text-muted">Custom Review</div><div className="mt-1 text-sm font-medium text-white">{customUnlocked ? "Unlocked" : "Locked until required review is done"}</div></div>
                  </div>
                </SurfaceCard>
              </div>
              <SurfaceCard padding="lg" className="relative">
                {!customUnlocked ? (
                  <button
                    type="button"
                    onClick={handleCustomReviewClick}
                    className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(12,7,25,0.58)] p-5 text-left backdrop-blur-[2px]"
                    aria-label="Custom Review is locked"
                  >
                    <span className="max-w-md rounded-[1.6rem] border border-warm-border bg-[rgba(32,20,56,0.94)] p-5 text-center shadow-bubble">
                      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[1.1rem] border border-white/20 bg-[linear-gradient(180deg,#fff8fd,#ffdff4)] text-[#10091d] shadow-[0_4px_0_rgba(0,0,0,0.18)]">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-6 w-6"
                          aria-hidden="true"
                        >
                          <rect x="4" y="11" width="16" height="9" rx="2" />
                          <path d="M8 11V8a4 4 0 1 1 8 0v3" />
                        </svg>
                      </span>
                      <span className="mt-3 block text-lg font-bold text-white">
                        Custom Review is locked
                      </span>
                      <span className="mt-2 block text-sm leading-6 text-text-secondary">
                        Complete your required Daily Review first.
                      </span>
                    </span>
                  </button>
                ) : null}
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">Custom review</div>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">Pick decks, tags, or both. Custom practice does not change scheduling.</p>
                  </div>
                  <Button type="button" onClick={handleCustomReviewClick} disabled={customUnlocked && customPreviewCards.length === 0} size="lg">Start custom review</Button>
                </div>
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-3 text-sm font-semibold text-white">Choose decks</div>
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
                    <div className="mb-3 text-sm font-semibold text-white">Choose tags</div>
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
                <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-text-secondary">
                  <span>{customPreviewCards.length} selected</span>
                  {!customUnlocked ? (
                    <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-medium text-warm-accent">Finish required Daily Review first</span>
                  ) : null}
                </div>
              </SurfaceCard>
            </>
          ) : null}
          {sessionKind === null ? null : done ? (
            totalCards === 0 ? (
              <EmptyState
                emoji="Cards"

                title="No cards in this session"
                description={sessionKind === "daily-required" ? "You have no required daily cards left right now." : sessionKind === "daily-optional" ? "There are no optional easy cards left right now." : "Choose at least one deck or tag to start a custom review."}
                action={<Button type="button" onClick={exitSession}>Back to study modes</Button>}
              />
            ) : (
              <SurfaceCard tone="warm" padding="lg" className="animate-warm-glow-pulse">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Session complete</h2>
                  <p className="mt-3 text-sm leading-7 text-text-secondary sm:text-base">You reviewed {sessionStats.reviewedCards} of {totalCards} card{totalCards === 1 ? "" : "s"}.</p>
                </div>
                <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm"><div className="text-xs text-text-muted">Accuracy</div><div className="mt-2 text-2xl font-semibold">{accuracyPercentage}%</div></div>
                  <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm">
                    <div className="text-xs text-text-muted">Ratings</div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-text-secondary">
                      {(["again", "hard", "good", "easy"] as CardRating[]).map((rating) => (
                        <span key={rating} className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1">
                          {RATING_LABELS[rating]} {sessionStats.ratings[rating]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm"><div className="text-xs text-text-muted">Goals completed</div><div className="mt-2 text-2xl font-semibold">{sessionStats.completedGoals}</div></div>
                  <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm"><div className="text-xs text-text-muted">Rewards</div><div className="mt-2 text-sm text-text-secondary">{sessionStats.starsEarned} star{sessionStats.starsEarned === 1 ? "" : "s"}</div></div>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button type="button" onClick={() => startSession(sessionKind)} size="lg" variant="warm">Study again</Button>
                  <Button type="button" onClick={exitSession} variant="secondary" size="lg">Back to study modes</Button>
                </div>
              </SurfaceCard>
            )
          ) : current ? (
            <div key={current.id} className="animate-slide-up space-y-6">
              <SurfaceCard padding="lg" className="overflow-hidden">
                <div className="space-y-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">{sessionKind === "custom" ? "Custom review" : sessionKind === "daily-optional" ? "Optional daily review" : "Required daily review"}</div>
                      <div className="mt-2 text-sm leading-6 text-text-secondary sm:text-base">Card {currentCardNumber} of {totalCards}</div>
                    </div>
                    <div className="text-sm font-semibold text-text-secondary">{progressPercent}% complete</div>
                  </div>
                  <ProgressBar progress={progressPercent} />
                  <div className="mx-auto w-full max-w-[58rem] perspective-[1400px]" onClick={!flipped ? handleFlip : undefined} onKeyDown={(event) => { if (flipped) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handleFlip(); } }} role="button" tabIndex={0} aria-label={flipped ? "Flashcard answer shown" : "Flip flashcard"}>
                    <div className={`relative aspect-[4/3] w-full transition-transform duration-slow ease-standard [transform-style:preserve-3d] sm:aspect-[16/11] xl:aspect-[16/10] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}>
                      <div className="absolute inset-0 flex flex-col rounded-[2rem] border border-white/[0.08] bg-surface-panel p-6 shadow-shell [backface-visibility:hidden] sm:p-8 lg:p-10">
                        <div className="flex flex-wrap gap-2">
                          {current.tags.map((tag) => <span key={tag} className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent">{tag}</span>)}
                        </div>
                        <div className="flex flex-1 items-center justify-center py-6"><p className="max-w-4xl text-center text-2xl font-bold leading-tight sm:text-3xl xl:text-[2.65rem]">{current.front}</p></div>
                        <div className="text-center text-xs uppercase tracking-[0.2em] text-text-muted">{flipped ? "" : "Tap or press Space to reveal the answer"}</div>
                      </div>
                      <div className="absolute inset-0 flex flex-col rounded-[2rem] border border-accent/30 bg-surface-panel p-6 shadow-shell [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8 lg:p-10">
                        <div className="flex flex-wrap gap-2">{current.tags.map((tag) => <span key={tag} className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent">{tag}</span>)}</div>
                        <div className="flex flex-1 items-center justify-center py-6"><p className="max-w-4xl text-center text-2xl font-bold leading-tight text-white sm:text-3xl xl:text-[2.65rem]">{current.back}</p></div>
                        <div className="text-center text-xs uppercase tracking-[0.2em] text-text-muted">How well did you recall this?</div>
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
                    explanationCache={explanationCache}
                  />
                </div>
              ) : null}
              {flipped ? (
                <div className="animate-fade-in space-y-3">
                  {savingRating ? <div className="text-center text-sm text-text-muted">Saving...</div> : null}
                  {showExplanation ? (
                    <StudyAssistant card={current} autoExplain mode="review" deckName={deckNamesById[current.deckId]} onContinue={goNext} explanationCache={explanationCache} />
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-4">
                        {([
                          { rating: "again" as CardRating, key: "1", hint: "Missed it", color: "border border-transparent bg-error text-white shadow-card hover:-translate-y-[1px] hover:brightness-110" },
                          { rating: "hard" as CardRating, key: "2", hint: "Barely recalled", color: "border border-amber-400/35 bg-amber-500/15 text-amber-100 hover:border-amber-300/60 hover:bg-amber-500/20" },
                          { rating: "good" as CardRating, key: "3", hint: "Recalled", color: "border border-border bg-white/[0.06] text-white hover:border-border-strong hover:bg-white/[0.10]" },
                          { rating: "easy" as CardRating, key: "4", hint: "Instant", color: "border border-transparent bg-success text-white shadow-card hover:-translate-y-[1px] hover:brightness-110" },
                        ]).map(({ rating, key, hint, color }) => (
                          <button
                            key={rating}
                            type="button"
                            disabled={savingRating !== null}
                            className={`flex min-h-[5.25rem] flex-col items-center justify-center gap-1 rounded-[1.75rem] px-4 py-4 text-sm font-semibold shadow-card transition duration-fast ease-spring active:scale-[0.98] disabled:opacity-50 ${color}`}
                            onClick={() => void handleRating(rating)}
                          >
                            <span>{RATING_LABELS[rating]}</span>
                            <span className="text-xs opacity-70">{hint}</span>
                            <span className="text-xs opacity-70">{key}</span>
                          </button>
                        ))}
                      </div>
                      <StudyAssistant card={current} autoExplain={false} mode="review" deckName={deckNamesById[current.deckId]} onContinue={goNext} explanationCache={explanationCache} />
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
