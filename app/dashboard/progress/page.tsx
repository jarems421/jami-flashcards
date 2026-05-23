"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useUser } from "@/lib/auth/user-context";
import { featureFlags } from "@/lib/app/feature-flags";
import { buildTopicProgress } from "@/lib/practice/progress";
import type { Topic } from "@/lib/practice/topics";
import type { Question, Attempt } from "@/lib/practice/questions";
import type { MasteryEvent } from "@/lib/practice/mastery";
import type { Card as StudyCard } from "@/lib/study/cards";
import { getActiveTopics } from "@/services/study/topics";
import { getActiveQuestions, getAttempts } from "@/services/study/practice";
import { getMasteryEvents } from "@/services/study/mastery";
import { ensureStudyStateSetup, loadUserCards } from "@/services/study/daily-review";
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

const surfaceCardClass =
  "rounded-[1.2rem] border border-white/[0.09] bg-white/[0.04] p-4 shadow-[0_10px_22px_rgba(4,8,18,0.12)]";

export default function ProgressPage() {
  const { user } = useUser();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [masteryEvents, setMasteryEvents] = useState<MasteryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setFeedback(null);
      try {
        await ensureStudyStateSetup(user.uid);
        const [nextTopics, nextCards, nextQuestions, nextAttempts, nextMasteryEvents] =
          await Promise.all([
            getActiveTopics(user.uid),
            loadUserCards(user.uid),
            getActiveQuestions(user.uid),
            getAttempts(user.uid),
            getMasteryEvents(user.uid),
          ]);

        if (!cancelled) {
          setTopics(nextTopics);
          setCards(nextCards);
          setQuestions(nextQuestions);
          setAttempts(nextAttempts);
          setMasteryEvents(nextMasteryEvents);
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
    () => buildTopicProgress({ topics, cards, questions, attempts, masteryEvents }),
    [attempts, cards, masteryEvents, questions, topics]
  );
  const weakTopics = topicProgress.slice(0, 5);
  const practiceAccuracy = useMemo(() => {
    if (attempts.length === 0) return 0;
    return Math.round((attempts.filter((attempt) => attempt.isCorrect).length / attempts.length) * 100);
  }, [attempts]);
  const supportedAttempts = useMemo(
    () => attempts.filter((attempt) => attempt.tutorUsed || (attempt.hintsUsed ?? 0) > 0),
    [attempts]
  );
  const supportLevel = useMemo(() => {
    if (attempts.length === 0) return "Low";
    const ratio = supportedAttempts.length / attempts.length;
    if (ratio >= 0.6) return "High";
    if (ratio >= 0.25) return "Medium";
    return "Low";
  }, [attempts.length, supportedAttempts.length]);
  const weakCardCount = topicProgress.reduce((sum, topic) => sum + topic.weakCardCount, 0);
  const recentMistakes = useMemo(
    () =>
      attempts
        .filter((attempt) => !attempt.isCorrect)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 8),
    [attempts]
  );
  const questionsById = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions]
  );

  if (!featureFlags.enableMasteryProgress) {
    return (
      <AppPage title="Progress" backHref="/dashboard" backLabel="Today">
        <EmptyState
          emoji="Progress"
          eyebrow="Not enabled"
          title="Progress is behind a feature flag."
          description="Enable mastery progress after topics and practice are ready."
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
        eyebrow="Mastery tracks evidence"
        title="Weak topics, practice accuracy, and support level."
        description="This MVP view stays intentionally narrow: it combines memory risk and practice attempts without becoming a full analytics suite yet."
        tone="warm"
        aside={
          <div className="grid min-w-[18rem] grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-3">
              <div className="text-lg font-medium tabular-nums text-white">{topics.length}</div>
              <div className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-text-muted">Topics</div>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-3">
              <div className="text-lg font-medium tabular-nums text-white">{practiceAccuracy}%</div>
              <div className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-text-muted">Practice</div>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-3">
              <div className="text-lg font-medium tabular-nums text-white">{supportLevel}</div>
              <div className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] text-text-muted">Support</div>
            </div>
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
              { label: "Practice accuracy", value: `${practiceAccuracy}%`, tone: "good" },
              { label: "Support level", value: supportLevel, tone: "warm" },
            ]}
          />

          {topics.length === 0 ? (
            <EmptyState
              emoji="Topics"
              title="Progress needs topics"
              description="Create topics in Practise, then link questions and cards to start building mastery evidence."
              action={
                <Link
                  href="/dashboard/practise"
                  className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl border border-white/24 bg-[linear-gradient(180deg,#fff8fd_0%,#ffe8f7_42%,#ffdff4_100%)] px-4 py-2 text-sm font-medium text-[#10091d] shadow-[0_12px_24px_rgba(255,214,246,0.18)] transition duration-fast hover:-translate-y-[1px] hover:brightness-105"
                >
                  Open Practise
                </Link>
              }
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <Card padding="lg">
                <SectionHeader
                  title="Weak topics"
                  description="Topics answer: what learning concept does this test?"
                />
                <div className="mt-5 space-y-3">
                  {weakTopics.map((summary) => (
                    <div key={summary.topic.id} className={surfaceCardClass}>
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
                          <span>Practice accuracy</span>
                          <span className="tabular-nums text-white">{summary.accuracy}%</span>
                        </div>
                        <ProgressBar progress={summary.accuracy} />
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-4">
                        <MiniMetric label="Accuracy" value={`${summary.accuracy}%`} />
                        <MiniMetric label="Weak cards" value={summary.weakCardCount} />
                        <MiniMetric label="Due cards" value={summary.dueCardCount} />
                        <MiniMetric label="Support" value={summary.supportLevel} />
                      </div>
                      {summary.recentMistakes.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {summary.recentMistakes.map((mistake) => (
                            <span
                              key={mistake}
                              className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2.5 py-1 text-[0.68rem] text-text-secondary"
                            >
                              {mistake}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Card>

              <Card padding="lg">
                <SectionHeader
                  title="Recent mistakes"
                  description="Fresh practice misses are the best repair opportunities."
                />
                <div className="mt-5 space-y-3">
                  {recentMistakes.length > 0 ? (
                    recentMistakes.map((attempt) => {
                      const question = questionsById.get(attempt.questionId);
                      return (
                        <div
                          key={attempt.id}
                          className={surfaceCardClass}
                        >
                          <div className="line-clamp-2 text-sm font-semibold text-white">
                            {question?.questionText ?? "Practice question"}
                          </div>
                          <div className="mt-2 text-xs text-text-muted">
                            Confidence {attempt.confidence} - {attempt.tutorUsed ? "Tutor used" : "No tutor"}
                          </div>
                          {attempt.mistakeLabels.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {attempt.mistakeLabels.map((label) => (
                                <span
                                  key={label}
                                  className="rounded-full border border-white/[0.10] bg-white/[0.05] px-2 py-1 text-[0.65rem] text-text-secondary"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm leading-6 text-text-secondary">
                      No incorrect practice attempts yet. Once you miss a question, Jami will show
                      it here as a repair target.
                    </p>
                  )}
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </AppPage>
  );
}

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
