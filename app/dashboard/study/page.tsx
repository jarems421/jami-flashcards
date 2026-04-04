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
import { useUser } from "@/lib/user-context";
import { db } from "@/services/firebase";
import { ensureConstellationSetup } from "@/services/constellations";
import { updateCardSchedule, type CardRating } from "@/lib/scheduler";
import { getUpdatedGoalAfterAnswer, normalizeGoal } from "@/lib/goals";
import { createDustForCardReview } from "@/services/dust";
import { createStarForGoalIfMissing } from "@/services/stars";
import { getDecks } from "@/services/decks";
import {
  cardMatchesAnyTag,
  mapCardData,
  parseCardTagsParam,
  type Card,
} from "@/lib/cards";

type StudyMode = "due" | "all";

type SessionStats = {
  reviewedCards: number;
  correctAnswers: number;
  completedGoals: number;
  starsEarned: number;
  dustEarned: number;
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
    dustEarned: 0,
    ratings: {
      again: 0,
      hard: 0,
      good: 0,
      easy: 0,
    },
  };
}

export default function TagStudyPage() {
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
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
      const isCorrect = rating === "good" || rating === "easy";
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

      const [, createdDust] = await Promise.all([
        updateDoc(doc(db, "cards", current.id), schedule),
        createDustForCardReview(user.uid, current.id),
      ]);
      const goalResults = await Promise.all(goalUpdates);
      const completedGoals = goalResults.reduce(
        (sum, result) => sum + result.completedGoals,
        0
      );
      const starsEarned = goalResults.reduce(
        (sum, result) => sum + result.starsEarned,
        0
      );

      if (!isMountedRef.current) {
        return;
      }

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
        dustEarned: prev.dustEarned + (createdDust ? 1 : 0),
        ratings: {
          ...prev.ratings,
          [rating]: prev.ratings[rating] + 1,
        },
      }));

      goNext();
    } catch (e) {
      console.error(e);
      if (isMountedRef.current) {
        setFeedback({
          type: "error",
          message: "Failed to save that rating. Please try again.",
        });
      }
    } finally {
      if (isMountedRef.current) {
        setSavingRating(null);
      }
    }
  };

  const handleFlip = useCallback(() => {
    if (!current || flipped) {
      return;
    }

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
        "1": "again",
        "2": "hard",
        "3": "good",
        "4": "easy",
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
    <main data-app-surface="true" className="flex min-h-screen flex-col items-center p-6 text-white">
      <div className="mb-6 flex w-full max-w-lg items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Study by tag</h1>
          <p className="text-sm text-text-muted">{tagSummary || "Select tags from your decks"}</p>
        </div>
        <Link
          href="/dashboard/decks"
          className="rounded-md bg-glass-medium px-3 py-1.5 text-sm transition duration-fast hover:bg-glass-strong"
        >
          Back to decks
        </Link>
      </div>

      {feedback ? (
        <div
          className={`mb-4 flex w-full max-w-lg items-center justify-between gap-4 rounded-md p-3 text-sm ${
            feedback.type === "error"
              ? "bg-error-muted text-red-200"
              : "bg-success-muted text-emerald-200"
          }`}
        >
          <div>{feedback.message}</div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="rounded-md bg-glass-medium px-3 py-1 text-xs hover:bg-glass-strong"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {selectedTags.length > 0 ? (
        <div className="mb-4 flex w-full max-w-lg flex-wrap gap-2">
          {selectedTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent"
            >
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mb-6 flex w-full max-w-lg gap-2">
        <button
          type="button"
          onClick={() => resetSession("due")}
          className={`rounded-md px-4 py-2 text-sm transition duration-fast ${studyMode === "due" ? "bg-accent" : "bg-glass-medium hover:bg-glass-strong"}`}
        >
          Due cards
        </button>
        <button
          type="button"
          onClick={() => resetSession("all")}
          className={`rounded-md px-4 py-2 text-sm transition duration-fast ${studyMode === "all" ? "bg-accent" : "bg-glass-medium hover:bg-glass-strong"}`}
        >
          All matching cards
        </button>
      </div>

      {!loaded ? (
        <p className="text-sm text-text-muted">Loading study cards…</p>
      ) : done ? (
        totalCards === 0 ? (
          <div
            className="w-full max-w-lg space-y-3 rounded-xl border border-warm-border bg-warm-glow p-5"
            style={{ backgroundImage: "var(--gradient-card)" }}
          >
            <p className="text-text-secondary">
              {selectedTags.length === 0
                ? "Choose one or more tags from your decks page to begin."
                : studyMode === "due"
                  ? "No cards with those tags are due right now. Try all matching cards instead."
                  : "No cards match those tags yet."}
            </p>
            <Link
              href="/dashboard/decks"
              className="inline-block rounded-md bg-glass-medium px-4 py-2 text-sm hover:bg-glass-strong"
            >
              Back to decks
            </Link>
          </div>
        ) : (
          <div
            className="w-full max-w-lg space-y-5 rounded-xl border border-warm-border bg-glass-subtle p-6 animate-warm-glow-pulse"
            style={{
              backgroundImage: "var(--gradient-card)",
              animation: "slide-up var(--duration-slow) var(--ease-standard) both, warm-glow-pulse 2s ease 1 var(--duration-slow)",
            }}
          >
            <div>
              <h2 className="text-lg font-bold">Session complete</h2>
              <p className="mt-1 text-sm text-text-secondary">
                You reviewed {sessionStats.reviewedCards} of {totalCards} tagged card{totalCards === 1 ? "" : "s"}.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-white/[0.07] bg-glass-medium p-3 animate-fade-in">
                <div className="text-xs text-text-muted">Accuracy</div>
                <div className="text-lg font-bold">{accuracyPercentage}%</div>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-glass-medium p-3 animate-fade-in [animation-delay:80ms]">
                <div className="text-xs text-text-muted">Ratings</div>
                <div className="text-xs text-text-secondary">
                  {sessionStats.ratings.again}a · {sessionStats.ratings.hard}h · {sessionStats.ratings.good}g · {sessionStats.ratings.easy}e
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-glass-medium p-3 animate-fade-in [animation-delay:160ms]">
                <div className="text-xs text-text-muted">Goals completed</div>
                <div className="text-lg font-bold">{sessionStats.completedGoals}</div>
              </div>
              <div className="rounded-lg border border-white/[0.07] bg-glass-medium p-3 animate-fade-in [animation-delay:240ms]">
                <div className="text-xs text-text-muted">Rewards</div>
                <div className="text-xs text-text-secondary">
                  {sessionStats.starsEarned} star{sessionStats.starsEarned === 1 ? "" : "s"} · {sessionStats.dustEarned} dust
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => resetSession(studyMode)}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium transition duration-fast hover:bg-accent-hover"
              >
                Study again
              </button>
              <Link
                href="/dashboard/decks"
                className="rounded-md bg-glass-medium px-4 py-2 text-sm hover:bg-glass-strong"
              >
                Pick other tags
              </Link>
            </div>
          </div>
        )
      ) : current ? (
        <div key={current.id} className="w-full max-w-lg animate-slide-up space-y-5">
          <div>
            <div className="mb-1 flex justify-between text-xs text-text-muted">
              <span>Card {currentCardNumber} of {totalCards}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-glass-medium">
              <div
                className="h-1.5 rounded-full bg-accent transition-all duration-slow"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div
            className="perspective-[800px]"
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
              className={`relative w-full transition-transform duration-normal ease-standard [transform-style:preserve-3d] ${
                flipped ? "[transform:rotateY(180deg)]" : ""
              }`}
              style={{ aspectRatio: "3 / 2" }}
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-border bg-glass-subtle p-6 shadow-card [backface-visibility:hidden]">
                <div className="mb-auto flex flex-wrap justify-center gap-2">
                  {currentDeckName ? (
                    <span className="rounded-full border border-border bg-glass-medium px-3 py-1 text-xs text-text-muted">
                      {currentDeckName}
                    </span>
                  ) : null}
                  {current.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
                <p className="text-center text-lg">{current.front}</p>
                <div className="mt-auto pt-4">
                  <span className="text-xs text-text-muted">
                    {flipped ? "" : "Tap or press Space to flip card"}
                  </span>
                </div>
              </div>

              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-accent/30 bg-glass-subtle p-6 shadow-card [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <div className="mb-auto flex flex-wrap justify-center gap-2">
                  {currentDeckName ? (
                    <span className="rounded-full border border-border bg-glass-medium px-3 py-1 text-xs text-text-muted">
                      {currentDeckName}
                    </span>
                  ) : null}
                  {current.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
                <p className="text-center text-lg">{current.back}</p>
                <div className="mt-auto pt-4">
                  <span className="text-xs text-text-muted">How well did you recall this?</span>
                </div>
              </div>
            </div>
          </div>

          {totalCards - index > 1 ? (
            <div className="pointer-events-none relative -mt-4 flex justify-center">
              <div className="h-2 w-[92%] rounded-b-xl border border-t-0 border-border bg-glass-medium opacity-60" />
            </div>
          ) : null}
          {totalCards - index > 2 ? (
            <div className="pointer-events-none relative -mt-3 flex justify-center">
              <div className="h-2 w-[84%] rounded-b-xl border border-t-0 border-border bg-glass-medium opacity-30" />
            </div>
          ) : null}

          {flipped ? (
            <div className="animate-fade-in space-y-3">
              {savingRating ? (
                <div className="text-center text-sm text-text-muted">Saving…</div>
              ) : null}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  { rating: "again" as CardRating, label: "Again", key: "1", color: "bg-error/60 hover:bg-error/80 active:bg-error/90" },
                  { rating: "hard" as CardRating, label: "Hard", key: "2", color: "bg-glass-medium hover:bg-glass-strong active:bg-glass-strong" },
                  { rating: "good" as CardRating, label: "Good", key: "3", color: "bg-accent/70 hover:bg-accent active:bg-accent" },
                  { rating: "easy" as CardRating, label: "Easy", key: "4", color: "bg-success/70 hover:bg-success active:bg-success" },
                ]).map(({ rating, label, key, color }) => (
                  <button
                    key={rating}
                    type="button"
                    disabled={savingRating !== null}
                    className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-3 text-sm font-medium transition duration-fast active:scale-[0.97] disabled:opacity-50 ${color}`}
                    onClick={() => void handleRating(rating)}
                  >
                    <span>{label}</span>
                    <span className="text-xs text-white/50">{key}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}