"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  collection,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { db } from "@/services/firebase/client";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import { updateCardSchedule, type CardRating } from "@/lib/study/scheduler";
import { getUpdatedGoalAfterAnswer, normalizeGoal } from "@/lib/study/goals";
import { recordStudyReview } from "@/services/study/activity";
import { createStarForGoalIfMissing } from "@/services/constellation/stars";
import { getDecks } from "@/services/study/decks";
import {
  cardMatchesAnyTag,
  mapCardData,
  parseCardTagsParam,
  type Card,
} from "@/lib/study/cards";
import AppPage from "@/components/layout/AppPage";
import { Button, Card as SurfaceCard, EmptyState, FeedbackBanner, ProgressBar } from "@/components/ui";

type StudyMode = "due" | "all";

type SessionStats = {
  reviewedCards: number;
  correctAnswers: number;
  completedGoals: number;
  starsEarned: number;
  ratings: Record<CardRating, number>;
};

function buildVisibleCards(cards: Card[], studyMode: StudyMode, now: number) {
  if (studyMode === "all") {
    return cards;
  }

  return cards
    .map((card, originalIndex) => ({
      card,
      originalIndex,
    }))
    .filter(({ card }) => !card.dueDate || card.dueDate <= now)
    .sort((a, b) => {
      if (!a.card.dueDate && !b.card.dueDate) {
        return a.originalIndex - b.originalIndex;
      }
      if (!a.card.dueDate) {
        return -1;
      }
      if (!b.card.dueDate) {
        return 1;
      }
      if (a.card.dueDate !== b.card.dueDate) {
        return a.card.dueDate - b.card.dueDate;
      }
      return a.originalIndex - b.originalIndex;
    })
    .map(({ card }) => card);
}

function createEmptySessionStats(): SessionStats {
  return {
    reviewedCards: 0,
    correctAnswers: 0,
    completedGoals: 0,
    starsEarned: 0,
    ratings: {
      wrong: 0,
      right: 0,
      again: 0,
    },
  };
}

export default function StudyPage() {
  const searchParams = useSearchParams();
  const { user } = useUser();
  const tagParam = searchParams.get("tags");
  const selectedTags = parseCardTagsParam(tagParam);
  const tagSummary = selectedTags.map((tag) => `#${tag}`).join(" · ");

  const [cards, setCards] = useState<Card[]>([]);
  const [sessionCards, setSessionCards] = useState<Card[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [savingRating, setSavingRating] = useState<CardRating | null>(null);
  const [studyMode, setStudyMode] = useState<StudyMode>("due");
  const studyModeRef = useRef<StudyMode>("due");
  const [sessionStats, setSessionStats] = useState<SessionStats>(
    createEmptySessionStats()
  );
  const [feedback, setFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const [deckNamesById, setDeckNamesById] = useState<Record<string, string>>({});
  const flipTimestampRef = useRef<number>(0);

  useEffect(() => {
    studyModeRef.current = studyMode;
  }, [studyMode]);

  useEffect(() => {
    const nextSelectedTags = parseCardTagsParam(tagParam);

    if (nextSelectedTags.length === 0) {
      setCards([]);
      setSessionCards([]);
      setSessionStats(createEmptySessionStats());
      setFeedback({
        type: "error",
        message: "Choose at least one tag from the decks page to start a topic study session.",
      });
      setLoaded(true);
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoaded(false);
      setFeedback(null);

      try {
        await ensureConstellationSetup(user.uid);

        const cardsQuery = query(collection(db, "cards"), where("userId", "==", user.uid));
        const [snapshot, decks] = await Promise.all([getDocs(cardsQuery), getDecks(user.uid)]);

        if (cancelled) {
          return;
        }

        const nextDeckNamesById = Object.fromEntries(
          decks.map((deck) => [deck.id, deck.name])
        );
        const list = snapshot.docs
          .map((cardDoc) => mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>))
          .filter((card) => cardMatchesAnyTag(card, nextSelectedTags));

        const sortedCards = list
          .map((card, originalIndex) => ({
            card,
            originalIndex,
          }))
          .sort(
            (a, b) =>
              b.card.createdAt - a.card.createdAt || a.originalIndex - b.originalIndex
          )
          .map(({ card }) => card);

        setDeckNamesById(nextDeckNamesById);
        setCards(sortedCards);
        setSessionCards(
          buildVisibleCards(sortedCards, studyModeRef.current, Date.now())
        );
        setSessionStats(createEmptySessionStats());
        setIndex(0);
        setFlipped(false);
        setLoaded(true);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setDeckNamesById({});
          setCards([]);
          setSessionCards([]);
          setSessionStats(createEmptySessionStats());
          setFeedback({
            type: "error",
            message: "Failed to load tagged study cards.",
          });
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tagParam, user.uid]);

  const resetSession = (nextMode: StudyMode) => {
    setStudyMode(nextMode);
    setSessionCards(buildVisibleCards(cards, nextMode, Date.now()));
    setSessionStats(createEmptySessionStats());
    setIndex(0);
    setFlipped(false);
    setSavingRating(null);
    setFeedback(null);
  };

  const done = loaded && (sessionCards.length === 0 || index >= sessionCards.length);
  const current = loaded && !done ? sessionCards[index] : null;
  const totalCards = sessionCards.length;
  const currentCardNumber = current ? index + 1 : 0;
  const accuracyPercentage =
    sessionStats.reviewedCards > 0
      ? Math.round((sessionStats.correctAnswers / sessionStats.reviewedCards) * 100)
      : 0;
  const currentDeckName = current ? deckNamesById[current.deckId] ?? "Unknown deck" : null;

  const goNext = () => {
    setIndex((value) => value + 1);
    setFlipped(false);
  };

  const handleRating = async (rating: CardRating) => {
    if (!current) {
      return;
    }

    setSavingRating(rating);
    setFeedback(null);

    try {
      const now = Date.now();
      const schedule = updateCardSchedule(current, rating);
      const isCorrect = rating === "right";
      const goalsCollection = collection(db, "users", user.uid, "goals");
      const activeGoalsSnapshot = await getDocs(
        query(goalsCollection, where("status", "==", "active"))
      );

      const goalUpdates = activeGoalsSnapshot.docs.map(async (goalDoc) => {
        const goal = normalizeGoal(
          goalDoc.id,
          goalDoc.data() as Record<string, unknown>
        );

        const updatedGoal = getUpdatedGoalAfterAnswer(goal, isCorrect, now);

        await updateDoc(doc(db, "users", user.uid, "goals", goal.id), {
          progress: updatedGoal.progress,
          status: updatedGoal.status,
        });

        if (goal.status === "active" && updatedGoal.status === "completed") {
          const createdStar = await createStarForGoalIfMissing(user.uid, updatedGoal);
          return {
            completedGoals: 1,
            starsEarned: createdStar ? 1 : 0,
          };
        }

        return {
          completedGoals: 0,
          starsEarned: 0,
        };
      });

      const [, , goalResults] = await Promise.all([
        updateDoc(doc(db, "cards", current.id), schedule),
        recordStudyReview(user.uid, now, {
          isCorrect,
          durationMs: flipTimestampRef.current > 0
            ? now - flipTimestampRef.current
            : undefined,
        }),
        Promise.all(goalUpdates),
      ]);
      const completedGoals = goalResults.reduce(
        (sum, result) => sum + result.completedGoals,
        0
      );
      const starsEarned = goalResults.reduce(
        (sum, result) => sum + result.starsEarned,
        0
      );

      setCards((prev) =>
        prev.map((card) =>
          card.id === current.id
            ? {
                ...card,
                ...schedule,
              }
            : card
        )
      );
      setSessionStats((prev) => ({
        reviewedCards: prev.reviewedCards + 1,
        correctAnswers: prev.correctAnswers + (isCorrect ? 1 : 0),
        completedGoals: prev.completedGoals + completedGoals,
        starsEarned: prev.starsEarned + starsEarned,
        ratings: {
          ...prev.ratings,
          [rating]: prev.ratings[rating] + 1,
        },
      }));

      goNext();
    } catch (e) {
      console.error(e);
      setFeedback({
        type: "error",
        message: "Failed to save that rating. Please try again.",
      });
    } finally {
      setSavingRating(null);
    }
  };

  const handleFlip = useCallback(() => {
    if (!current || flipped) {
      return;
    }

    flipTimestampRef.current = Date.now();
    setFlipped(true);
  }, [current, flipped]);

  const handleRatingRef = useRef(handleRating);
  useEffect(() => {
    handleRatingRef.current = handleRating;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (!flipped && current) {
          setFlipped(true);
        }
        return;
      }

      if (!flipped || savingRating !== null || !current) {
        return;
      }

      const ratingMap: Record<string, CardRating> = {
        "1": "wrong",
        "2": "again",
        "3": "right",
      };
      const rating = ratingMap[event.key];
      if (rating) {
        event.preventDefault();
        void handleRatingRef.current(rating);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, flipped, savingRating]);

  const progressPercent = totalCards > 0 ? Math.round((index / totalCards) * 100) : 0;

  return (
    <AppPage
      title="Study by tag"
      backHref="/dashboard/decks"
      backLabel="Decks"
      width="study"
      contentClassName="space-y-6"
    >
      {feedback ? (
        <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_300px]">
        <SurfaceCard padding="md">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
            Topic session
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
            Pull matching cards across your deck library and stay inside one theme until it feels sharper.
          </p>

          {selectedTags.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {selectedTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-medium text-accent"
                >
                  #{tag}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-5 text-sm text-text-muted">
              Select tags from your decks to build a focused cross-deck session.
            </p>
          )}

          {tagSummary ? (
            <p className="mt-4 text-sm text-text-secondary">
              {tagSummary}
            </p>
          ) : null}
        </SurfaceCard>

        <SurfaceCard tone="warm" padding="md">
          <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
            Study mode
          </div>
          <div className="mt-4 grid gap-3">
            <Button
              type="button"
              onClick={() => resetSession("due")}
              variant={studyMode === "due" ? "primary" : "secondary"}
              className="justify-start"
            >
              Due cards
            </Button>
            <Button
              type="button"
              onClick={() => resetSession("all")}
              variant={studyMode === "all" ? "primary" : "secondary"}
              className="justify-start"
            >
              All matching cards
            </Button>
          </div>
        </SurfaceCard>
      </div>

      {!loaded ? (
        <p className="text-sm text-text-muted">Loading study cards...</p>
      ) : done ? (
        totalCards === 0 ? (
          <EmptyState
            emoji="📚"
            title="No cards to study"
            description={
              selectedTags.length === 0
                ? "Choose one or more tags from your decks page to begin."
                : studyMode === "due"
                  ? "No cards with those tags are due right now. Try all matching cards instead."
                  : "No cards match those tags yet."
            }
            action={
              <Link
                href="/dashboard/decks"
                className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
              >
                Back to decks
              </Link>
            }
          />
        ) : (
          <SurfaceCard tone="warm" padding="lg" className="animate-warm-glow-pulse">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Session complete</h2>
              <p className="mt-3 text-sm leading-7 text-text-secondary sm:text-base">
                You reviewed {sessionStats.reviewedCards} of {totalCards} tagged card{totalCards === 1 ? "" : "s"}.
              </p>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm">
                <div className="text-xs text-text-muted">Accuracy</div>
                <div className="mt-2 text-2xl font-semibold">{accuracyPercentage}%</div>
              </div>
              <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm">
                <div className="text-xs text-text-muted">Ratings</div>
                <div className="mt-2 text-sm text-text-secondary">
                  {sessionStats.ratings.wrong}w · {sessionStats.ratings.right}r · {sessionStats.ratings.again}a
                </div>
              </div>
              <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm">
                <div className="text-xs text-text-muted">Goals completed</div>
                <div className="mt-2 text-2xl font-semibold">{sessionStats.completedGoals}</div>
              </div>
              <div className="rounded-[1.6rem] border border-white/[0.07] bg-white/[0.05] p-4 text-sm">
                <div className="text-xs text-text-muted">Rewards</div>
                <div className="mt-2 text-sm text-text-secondary">
                  {sessionStats.starsEarned} star{sessionStats.starsEarned === 1 ? "" : "s"}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button type="button" onClick={() => resetSession(studyMode)} size="lg" variant="warm">
                Study again
              </Button>
              <Link
                href="/dashboard/decks"
                className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
              >
                Pick other tags
              </Link>
            </div>
          </SurfaceCard>
        )
      ) : current ? (
        <div key={current.id} className="animate-slide-up space-y-6">
          <SurfaceCard padding="lg" className="overflow-hidden">
            <div className="space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                    Session progress
                  </div>
                  <div className="mt-2 text-sm leading-6 text-text-secondary sm:text-base">
                    Card {currentCardNumber} of {totalCards}
                  </div>
                </div>
                <div className="text-sm font-semibold text-text-secondary">
                  {progressPercent}% complete
                </div>
              </div>

              <ProgressBar progress={progressPercent} />

              <div
                className="mx-auto w-full max-w-[58rem] perspective-[1400px]"
                onClick={!flipped ? handleFlip : undefined}
                onKeyDown={(event) => {
                  if (flipped) {
                    return;
                  }
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleFlip();
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label={flipped ? "Flashcard answer shown" : "Flip flashcard"}
              >
                <div
                  className={`relative aspect-[4/3] w-full transition-transform duration-slow ease-standard [transform-style:preserve-3d] sm:aspect-[16/11] xl:aspect-[16/10] ${
                    flipped ? "[transform:rotateY(180deg)]" : ""
                  }`}
                >
                  <div className="absolute inset-0 flex flex-col rounded-[2rem] border border-white/[0.08] bg-surface-panel p-6 shadow-shell [backface-visibility:hidden] sm:p-8 lg:p-10">
                    <div className="flex flex-wrap gap-2">
                      {currentDeckName ? (
                        <span className="rounded-full border border-border bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-text-secondary">
                          {currentDeckName}
                        </span>
                      ) : null}
                      {current.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-1 items-center justify-center py-6">
                      <p className="max-w-4xl text-center text-2xl font-bold leading-tight sm:text-3xl xl:text-[2.65rem]">
                        {current.front}
                      </p>
                    </div>
                    <div className="text-center text-xs uppercase tracking-[0.2em] text-text-muted">
                      {flipped ? "" : "Tap or press Space to reveal the answer"}
                    </div>
                  </div>

                  <div className="absolute inset-0 flex flex-col rounded-[2rem] border border-accent/30 bg-surface-panel p-6 shadow-shell [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8 lg:p-10">
                    <div className="flex flex-wrap gap-2">
                      {currentDeckName ? (
                        <span className="rounded-full border border-border bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-text-secondary">
                          {currentDeckName}
                        </span>
                      ) : null}
                      {current.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-1 items-center justify-center py-6">
                      <p className="max-w-4xl text-center text-2xl font-bold leading-tight text-white sm:text-3xl xl:text-[2.65rem]">
                        {current.back}
                      </p>
                    </div>
                    <div className="text-center text-xs uppercase tracking-[0.2em] text-text-muted">
                      How well did you recall this?
                    </div>
                  </div>
                </div>
              </div>

              {totalCards - index > 1 ? (
                <div className="pointer-events-none relative -mt-5 flex justify-center">
                  <div className="h-3 w-[94%] rounded-b-[1.6rem] border border-t-0 border-border bg-white/[0.06] opacity-60" />
                </div>
              ) : null}
              {totalCards - index > 2 ? (
                <div className="pointer-events-none relative -mt-4 flex justify-center">
                  <div className="h-3 w-[88%] rounded-b-[1.5rem] border border-t-0 border-border bg-white/[0.04] opacity-35" />
                </div>
              ) : null}
            </div>
          </SurfaceCard>

          {flipped ? (
            <div className="animate-fade-in space-y-3">
              {savingRating ? (
                <div className="text-center text-sm text-text-muted">Savingâ€¦</div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                {([
                  { rating: "wrong" as CardRating, label: "Wrong", key: "1", color: "border border-transparent bg-error text-white shadow-card hover:-translate-y-[1px] hover:brightness-110" },
                  { rating: "again" as CardRating, label: "Again", key: "2", color: "border border-border bg-white/[0.06] text-white hover:border-border-strong hover:bg-white/[0.10]" },
                  { rating: "right" as CardRating, label: "Right", key: "3", color: "border border-transparent bg-success text-white shadow-card hover:-translate-y-[1px] hover:brightness-110" },
                ]).map(({ rating, label, key, color }) => (
                  <button
                    key={rating}
                    type="button"
                    disabled={savingRating !== null}
                    className={`flex min-h-[5.25rem] flex-col items-center justify-center gap-1 rounded-[1.75rem] px-4 py-4 text-sm font-semibold shadow-card transition duration-fast ease-spring active:scale-[0.98] disabled:opacity-50 ${color}`}
                    onClick={() => void handleRating(rating)}
                  >
                    <span>{label}</span>
                    <span className="text-xs opacity-70">{key}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </AppPage>
  );
}



