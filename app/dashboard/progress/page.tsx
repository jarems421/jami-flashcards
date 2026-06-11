"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { featureFlags } from "@/lib/app/feature-flags";
import { db } from "@/services/firebase/client";
import { buildTopicProgress } from "@/lib/practice/progress";
import type { MasteryEvent } from "@/lib/practice/mastery";
import type { Source } from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";
import type { Card as StudyCard } from "@/lib/study/cards";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import type { Notebook } from "@/lib/workspace/notebooks";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import { computeStudyStreak, type DailyStudyActivity } from "@/lib/study/activity";
import { getStudyDayKey, shiftStudyDayKey } from "@/lib/study/day";
import { normalizeGoal, type Goal } from "@/lib/study/goals";
import {
  buildProgressSectionSearch,
  getProgressSectionFromSearch,
  type ProgressSection,
} from "@/lib/study/progress-navigation";
import { getCustomStudyHref, getDeckStudyHref } from "@/lib/app/routes";
import { getGeneratedContentDrafts, type GeneratedContentDraft } from "@/services/study/generated-content";
import { getMasteryEvents } from "@/services/study/mastery";
import { loadUserCards } from "@/services/study/daily-review";
import { ensureStudyStateSetup } from "@/services/study/daily-review";
import { loadStudyActivity } from "@/services/study/activity";
import { getDecks, type Deck } from "@/services/study/decks";
import { getActiveSources } from "@/services/study/sources";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActiveTopics } from "@/services/study/topics";
import AppPage from "@/components/layout/AppPage";
import {
  Card,
  Button,
  ButtonLink,
  EmptyState,
  FeedbackBanner,
  MetricStrip,
  PageHero,
  ProgressBar,
  SectionHeader,
  Skeleton,
} from "@/components/ui";

type Feedback = { type: "success" | "error"; message: string };
const PROGRESS_VISITED_KEY = "jami:progress-visited";

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="app-chip rounded-[1rem] px-3 py-3">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-text-primary">{value}</div>
    </div>
  );
}

export default function ProgressPage() {
  const { user } = useUser();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [masteryEvents, setMasteryEvents] = useState<MasteryEvent[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [studyFolders, setStudyFolders] = useState<StudyFolder[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [studyActivity, setStudyActivity] = useState<DailyStudyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [section, setSection] = useState<ProgressSection>("overview");
  const [sectionStateReady, setSectionStateReady] = useState(false);
  const [sectionWasExplicit, setSectionWasExplicit] = useState(false);

  useEffect(() => {
    const applyUrlState = () => {
      const params = new URLSearchParams(window.location.search);
      setSection(getProgressSectionFromSearch(window.location.search));
      setSectionWasExplicit(params.has("section"));
      setSectionStateReady(true);
    };

    applyUrlState();
    window.addEventListener("popstate", applyUrlState);
    return () => window.removeEventListener("popstate", applyUrlState);
  }, []);

  useEffect(() => {
    if (!sectionStateReady) return;
    const nextSearch = buildProgressSectionSearch(
      window.location.search,
      section
    );
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [section, sectionStateReady]);

  useEffect(() => {
    if (loading || !sectionWasExplicit || section === "overview") return;
    const targetId =
      section === "decks" ? "progress-decks" : "progress-workspace";
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({
        block: "start",
        behavior: "auto",
      });
    });
  }, [loading, section, sectionWasExplicit]);

  useEffect(() => {
    try {
      localStorage.setItem(PROGRESS_VISITED_KEY, "true");
    } catch {
      // Local dashboard checklist only.
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      setFeedback(null);
      try {
        await ensureStudyStateSetup(user.uid);
        const [
          nextTopics,
          nextCards,
          nextMasteryEvents,
          nextDrafts,
          nextSources,
          nextStudyFolders,
          nextNotebooks,
          nextDecks,
          nextStudyActivity,
          goalsSnapshot,
        ] = await Promise.all([
          getActiveTopics(user.uid),
          loadUserCards(user.uid),
          getMasteryEvents(user.uid),
          getGeneratedContentDrafts(user.uid).catch(() => [] as GeneratedContentDraft[]),
          getActiveSources(user.uid).catch(() => [] as Source[]),
          getActiveStudyFolders(user.uid).catch(() => [] as StudyFolder[]),
          getActiveNotebooks(user.uid).catch(() => [] as Notebook[]),
          getDecks(user.uid).catch(() => [] as Deck[]),
          loadStudyActivity(user.uid).catch(() => [] as DailyStudyActivity[]),
          getDocs(collection(db, "users", user.uid, "goals")).catch(() => null),
        ]);

        if (!cancelled) {
          setTopics(nextTopics);
          setCards(nextCards);
          setMasteryEvents(nextMasteryEvents);
          setDrafts(nextDrafts);
          setSources(nextSources);
          setStudyFolders(nextStudyFolders);
          setNotebooks(nextNotebooks);
          setDecks(nextDecks);
          setStudyActivity(nextStudyActivity);
          setGoals(
            goalsSnapshot
              ? goalsSnapshot.docs.map((goalDoc) =>
                  normalizeGoal(
                    goalDoc.id,
                    goalDoc.data() as Record<string, unknown>
                  )
                )
              : []
          );
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setFeedback({ type: "error", message: "Failed to load Progress." });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  const topicProgress = useMemo(
    () => buildTopicProgress({ topics, cards, masteryEvents, sources, studyFolders, notebooks }),
    [cards, masteryEvents, notebooks, sources, studyFolders, topics]
  );
  const weakTopics = topicProgress.slice(0, 5);
  const weakCardCount = topicProgress.reduce((sum, topic) => sum + topic.weakCardCount, 0);
  const dueCardCount = topicProgress.reduce((sum, topic) => sum + topic.dueCardCount, 0);
  const activeDrafts = useMemo(
    () => drafts.filter((draft) => draft.contentStatus === "draft"),
    [drafts]
  );
  const recentNotebooks = useMemo(
    () => [...notebooks].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 4),
    [notebooks]
  );
  const reviewedThisWeek = useMemo(() => {
    const todayKey = getStudyDayKey();
    const recentKeys = new Set(
      Array.from({ length: 7 }, (_, index) =>
        shiftStudyDayKey(todayKey, -index)
      )
    );
    return studyActivity
      .filter((entry) => recentKeys.has(entry.dayKey))
      .reduce((sum, entry) => sum + entry.reviewCount, 0);
  }, [studyActivity]);
  const currentStreak = useMemo(
    () => computeStudyStreak(studyActivity),
    [studyActivity]
  );
  const deckHealth = useMemo(() => {
    const now = Date.now();
    return decks
      .map((deck) => {
        const deckCards = cards.filter((card) => card.deckId === deck.id);
        const risks = deckCards.map((card) => getMemoryRiskInfo(card, now));
        const averageRisk =
          risks.length > 0
            ? risks.reduce((sum, risk) => sum + risk.score, 0) / risks.length
            : Number.POSITIVE_INFINITY;
        return {
          deck,
          cardCount: deckCards.length,
          weakCount: risks.filter((risk) => risk.tier === "high").length,
          dueCount: deckCards.filter(
            (card) => typeof card.dueDate === "number" && card.dueDate <= now
          ).length,
          averageRisk,
        };
      })
      .filter((summary) => summary.cardCount > 0)
      .sort((left, right) => left.averageRisk - right.averageRisk);
  }, [cards, decks]);
  const strongestDeck = deckHealth[0] ?? null;
  const weakestDeck = deckHealth.at(-1) ?? null;
  const activeGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active"),
    [goals]
  );
  const missedGoal = useMemo(
    () =>
      goals
        .filter((goal) => goal.status === "failed")
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null,
    [goals]
  );
  const upcomingGoal = useMemo(
    () =>
      activeGoals
        .filter((goal) => goal.deadline > Date.now())
        .sort((left, right) => left.deadline - right.deadline)[0] ?? null,
    [activeGoals]
  );
  if (!featureFlags.enableMasteryProgress) {
    return (
      <AppPage title="Progress" backHref="/dashboard" backLabel="Today">
        <EmptyState
          emoji="Progress"
          eyebrow="Not enabled"
          title="Progress is behind a feature flag."
          description="Enable mastery progress after topics and notebooks are ready."
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Progress"
      backHref="/dashboard"
      backLabel="Today"
      width="3xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <PageHero
        eyebrow="Progress"
        title="What needs review"
        tone="warm"
        aside={
          <div className="grid w-full min-w-0 grid-cols-3 gap-2 text-center sm:min-w-[18rem]">
            <MiniMetric label="Reviewed" value={loading ? "..." : reviewedThisWeek} />
            <MiniMetric label="Streak" value={loading ? "..." : `${currentStreak}d`} />
            <MiniMetric label="Goals" value={loading ? "..." : activeGoals.length} />
          </div>
        }
      />

      <div
        className="app-subtle-panel flex flex-wrap gap-2 rounded-[1.15rem] p-2"
        aria-label="Progress sections"
      >
        {(
          [
            ["overview", "Overview"],
            ["decks", "Decks"],
            ["workspace", "Workspace"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={section === value ? "warm" : "ghost"}
            size="sm"
            aria-pressed={section === value}
            onClick={() => {
              setSection(value);
              setSectionWasExplicit(value !== "overview");
              const targetId =
                value === "decks"
                  ? "progress-decks"
                  : value === "workspace"
                    ? "progress-workspace"
                    : "progress-overview";
              window.requestAnimationFrame(() => {
                document.getElementById(targetId)?.scrollIntoView({
                  block: "start",
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)"
                  ).matches
                    ? "auto"
                    : "smooth",
                });
              });
            }}
          >
            {label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-96" />
        </div>
      ) : (
        <>
          <div id="progress-overview" className="scroll-mt-24">
            <MetricStrip
              items={[
                { label: "Weak topics", value: weakTopics.length, tone: weakTopics.length > 0 ? "danger" : "good" },
                { label: "Weak cards", value: weakCardCount, tone: weakCardCount > 0 ? "danger" : "good" },
                { label: "Due cards", value: dueCardCount, tone: dueCardCount > 0 ? "warm" : "good" },
                { label: "Reviewed this week", value: reviewedThisWeek, tone: reviewedThisWeek > 0 ? "good" : "warm" },
              ]}
            />
          </div>

          <Card tone="warm" padding="md">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Recommended next step
            </div>
            <div className="mt-2 text-lg font-semibold text-text-primary">
              {recentNotebooks[0]
                ? `Continue "${recentNotebooks[0].title}", then review any linked cards.`
                : "Open a folder and create a notebook for your next working session."}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {dueCardCount > 0 ? (
                <ButtonLink href={getCustomStudyHref({ mode: "daily" })}>
                  Start review
                </ButtonLink>
              ) : reviewedThisWeek === 0 ? (
                <ButtonLink href={getCustomStudyHref({ mode: "custom" })}>
                  Study for 10 minutes
                </ButtonLink>
              ) : null}
            </div>
          </Card>

          <div id="progress-workspace" className="scroll-mt-24">
            <Card padding="lg">
              <SectionHeader title="Goals and deadlines" />
              <div className="mt-5 space-y-3">
                {activeGoals[0] ? (
                  <div className="app-subtle-panel rounded-[1.1rem] p-4">
                    <div className="text-sm font-semibold text-text-primary">
                      {activeGoals[0].progress.cardsCompleted} / {activeGoals[0].targetCards} cards
                    </div>
                    <div className="mt-3">
                      <ProgressBar
                        progress={Math.min(
                          100,
                          Math.round(
                            (activeGoals[0].progress.cardsCompleted /
                              Math.max(1, activeGoals[0].targetCards)) *
                              100
                          )
                        )}
                      />
                    </div>
                    {upcomingGoal ? (
                      <p className="mt-3 text-xs text-text-muted">
                        Due {new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(upcomingGoal.deadline)}
                      </p>
                    ) : (
                      <p className="mt-3 text-xs text-text-muted">No deadline</p>
                    )}
                    <Link href="/dashboard/goals" className="mt-3 inline-flex text-sm font-semibold text-accent hover:underline">
                      Open goal
                    </Link>
                  </div>
                ) : missedGoal ? (
                  <div className="app-subtle-panel rounded-[1.1rem] p-4">
                    <div className="text-sm font-semibold text-text-primary">A goal expired before completion.</div>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">Use a smaller target and build momentum again.</p>
                    <Link href="/dashboard/goals#new-goal" className="mt-3 inline-flex text-sm font-semibold text-accent hover:underline">
                      Create an easier goal
                    </Link>
                  </div>
                ) : (
                  <div className="app-subtle-panel rounded-[1.1rem] p-4">
                    <p className="text-sm leading-6 text-text-secondary">Set a goal when you want a clear target and a star reward.</p>
                    <Link href="/dashboard/goals#new-goal" className="mt-3 inline-flex text-sm font-semibold text-accent hover:underline">
                      Create goal
                    </Link>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <Card id="progress-decks" className="scroll-mt-24" padding="lg">
            <SectionHeader title="Deck health" description="A simple view of what is holding well and what needs another pass." />
            {deckHealth.length > 0 ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {strongestDeck ? (
                  <div className="app-subtle-panel rounded-[1.15rem] p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Strongest deck</div>
                    <div className="mt-2 text-lg font-semibold text-text-primary">{strongestDeck.deck.name}</div>
                    <p className="mt-2 text-sm text-text-secondary">{strongestDeck.cardCount} cards, {strongestDeck.dueCount} due</p>
                    <Link href={getDeckStudyHref(strongestDeck.deck.id)} className="mt-3 inline-flex text-sm font-semibold text-accent hover:underline">
                      Review deck
                    </Link>
                  </div>
                ) : null}
                {weakestDeck ? (
                  <div className="app-subtle-panel rounded-[1.15rem] p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Needs attention</div>
                    <div className="mt-2 text-lg font-semibold text-text-primary">{weakestDeck.deck.name}</div>
                    <p className="mt-2 text-sm text-text-secondary">{weakestDeck.weakCount} weak, {weakestDeck.dueCount} due</p>
                    <Link href={getDeckStudyHref(weakestDeck.deck.id)} className="mt-3 inline-flex text-sm font-semibold text-accent hover:underline">
                      Review weak deck
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="app-subtle-panel mt-5 rounded-[1.15rem] p-4">
                <p className="text-sm leading-6 text-text-secondary">Add cards and review them to unlock deck health.</p>
                <Link href="/dashboard/cards" className="mt-3 inline-flex text-sm font-semibold text-accent hover:underline">Add cards</Link>
              </div>
            )}
          </Card>

          {topics.length === 0 ? (
            <EmptyState
              emoji="Topics"
              title="Progress needs linked study material"
              description="Create folders, notebooks, cards, or sources to build progress."
              action={
                <ButtonLink href="/dashboard/folders" variant="warm">
                  Open folders
                </ButtonLink>
              }
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <Card padding="lg">
                <SectionHeader
                  title="Weak topics"
                />
                <div className="mt-5 space-y-3">
                  {weakTopics.map((summary) => (
                    <div key={summary.topic.id} className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.04] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-lg font-semibold leading-tight text-white">{summary.topic.name}</div>
                          <div className="mt-1 text-sm text-text-muted">{summary.topic.subject}</div>
                        </div>
                        <div className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
                          Mastery {summary.masteryScore}
                        </div>
                      </div>
                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-text-muted">
                          <span>Card stability</span>
                          <span className="tabular-nums text-white">
                            {summary.cardCount > 0 ? Math.max(0, 100 - summary.weakCardCount * 20) : 0}%
                          </span>
                        </div>
                        <ProgressBar progress={summary.cardCount > 0 ? Math.max(0, 100 - summary.weakCardCount * 20) : 0} />
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-5">
                        <MiniMetric label="Cards" value={summary.cardCount} />
                        <MiniMetric label="Weak" value={summary.weakCardCount} />
                        <MiniMetric label="Due" value={summary.dueCardCount} />
                        <MiniMetric label="Notebooks" value={summary.notebookCount} />
                        <MiniMetric label="Sources" value={summary.sourceCount} />
                      </div>
                      <div className="mt-4 rounded-[1rem] border border-white/[0.08] bg-white/[0.04] px-3 py-3 text-sm leading-6 text-text-secondary">
                          <span className="font-semibold text-white">Next action:</span>{" "}
                          Open the linked work, then review related flashcards.
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <ButtonLink
                          href={`/dashboard/folders?topic=${encodeURIComponent(summary.topic.id)}`}
                          variant="secondary"
                          size="sm"
                        >
                          Open linked work
                        </ButtonLink>
                        <ButtonLink
                          href={getCustomStudyHref({ mode: "custom", tags: [summary.topic.name] })}
                          variant="secondary"
                          size="sm"
                        >
                          Review cards
                        </ButtonLink>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="space-y-4">
                <Card padding="lg">
                  <SectionHeader
                    title="Recent notebook work"
                  />
                  <div className="mt-5 space-y-3">
                    {recentNotebooks.length > 0 ? (
                      recentNotebooks.map((notebook) => (
                        <Link
                          key={notebook.id}
                          href={`/dashboard/notebooks/${encodeURIComponent(notebook.id)}`}
                          className="block rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-4 transition hover:border-warm-border hover:bg-white/[0.065]"
                        >
                          <div className="text-sm font-semibold text-white">{notebook.title}</div>
                          <div className="mt-2 text-xs text-text-muted">
                            {notebook.type.replaceAll("_", " ")} - updated {new Date(notebook.updatedAt).toLocaleDateString()}
                          </div>
                        </Link>
                      ))
                    ) : (
                      <div className="app-subtle-panel rounded-[1.1rem] p-4">
                        <p className="text-sm leading-6 text-text-secondary">No notebook work yet.</p>
                        <Link href="/dashboard/folders" className="mt-3 inline-flex text-sm font-semibold text-accent hover:underline">
                          Start a notebook
                        </Link>
                      </div>
                    )}
                  </div>
                </Card>

                <Card padding="lg">
                  <SectionHeader
                    title="Drafts waiting"
                  />
                  <div className="mt-5 space-y-3">
                    {activeDrafts.length > 0 ? (
                      activeDrafts.slice(0, 4).map((draft) => (
                        <div key={draft.id} className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-4">
                          <div className="mb-2 inline-flex rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
                            {draft.kind === "flashcard" ? "Flashcard draft" : "Notebook question draft"}
                          </div>
                          <div className="text-sm font-semibold text-white">
                            {draft.front ?? draft.questionText ?? draft.title}
                          </div>
                          <p className="mt-2 line-clamp-3 text-sm leading-6 text-text-secondary">
                            {draft.back ?? draft.answerText ?? "Review this draft before approving it."}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm leading-6 text-text-secondary">
                        No drafts waiting.
                      </p>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </AppPage>
  );
}
