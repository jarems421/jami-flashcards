"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useUser } from "@/lib/auth/user-context";
import { featureFlags } from "@/lib/app/feature-flags";
import { buildTopicProgress } from "@/lib/practice/progress";
import type { MasteryEvent } from "@/lib/practice/mastery";
import type { Source } from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";
import type { Card as StudyCard } from "@/lib/study/cards";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import type { Notebook } from "@/lib/workspace/notebooks";
import { getGeneratedContentDrafts, type GeneratedContentDraft } from "@/services/study/generated-content";
import { getMasteryEvents } from "@/services/study/mastery";
import { loadUserCards } from "@/services/study/daily-review";
import { ensureStudyStateSetup } from "@/services/study/daily-review";
import { getActiveSources } from "@/services/study/sources";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActiveTopics } from "@/services/study/topics";
import AppPage from "@/components/layout/AppPage";
import {
  Card,
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
    <div className="rounded-[1rem] border border-white/[0.08] bg-white/[0.04] px-3 py-3">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-white">{value}</div>
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
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

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
        ] = await Promise.all([
          getActiveTopics(user.uid),
          loadUserCards(user.uid),
          getMasteryEvents(user.uid),
          getGeneratedContentDrafts(user.uid).catch(() => [] as GeneratedContentDraft[]),
          getActiveSources(user.uid).catch(() => [] as Source[]),
          getActiveStudyFolders(user.uid).catch(() => [] as StudyFolder[]),
          getActiveNotebooks(user.uid).catch(() => [] as Notebook[]),
        ]);

        if (!cancelled) {
          setTopics(nextTopics);
          setCards(nextCards);
          setMasteryEvents(nextMasteryEvents);
          setDrafts(nextDrafts);
          setSources(nextSources);
          setStudyFolders(nextStudyFolders);
          setNotebooks(nextNotebooks);
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
          <div className="grid min-w-[18rem] grid-cols-3 gap-2 text-center">
            <MiniMetric label="Topics" value={loading ? "..." : topics.length} />
            <MiniMetric label="Notebooks" value={loading ? "..." : notebooks.length} />
            <MiniMetric label="Drafts" value={loading ? "..." : activeDrafts.length} />
          </div>
        }
      />

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
          <MetricStrip
            items={[
              { label: "Weak topics", value: weakTopics.length, tone: weakTopics.length > 0 ? "danger" : "good" },
              { label: "Weak cards", value: weakCardCount, tone: weakCardCount > 0 ? "danger" : "good" },
              { label: "Due cards", value: dueCardCount, tone: dueCardCount > 0 ? "warm" : "good" },
              { label: "Drafts waiting", value: activeDrafts.length, tone: activeDrafts.length > 0 ? "warm" : "good" },
            ]}
          />

          <Card tone="warm" padding="md">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Recommended next step
            </div>
            <div className="mt-2 text-lg font-semibold text-white">
              {recentNotebooks[0]
                ? `Continue "${recentNotebooks[0].title}", then review any linked cards.`
                : "Open a folder and create a notebook for your next working session."}
            </div>
          </Card>

          {topics.length === 0 ? (
            <EmptyState
              emoji="Topics"
              title="Progress needs linked study material"
              description="Create folders, notebooks, cards, or sources to build progress."
              action={
                <Link
                  href="/dashboard/folders"
                  className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-white/24 bg-[linear-gradient(180deg,#fff8fd_0%,#ffe8f7_42%,#ffdff4_100%)] px-4 py-2 text-sm font-medium text-[#10091d] shadow-[0_12px_24px_rgba(255,214,246,0.18)] transition duration-fast hover:-translate-y-[1px] hover:brightness-105"
                >
                  Open folders
                </Link>
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
                        Open the linked folder or notebook, continue the work, then review related flashcards.
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
                      <p className="text-sm leading-6 text-text-secondary">
                        No notebook work yet.
                      </p>
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
