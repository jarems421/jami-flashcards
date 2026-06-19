"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  Input,
  Skeleton,
} from "@/components/ui";
import { useUser } from "@/lib/auth/user-context";
import { buildTopicSummaries } from "@/lib/practice/topic-management";
import type { Topic } from "@/lib/practice/topics";
import { mapCardData, type Card as StudyCard } from "@/lib/study/cards";
import type { Source } from "@/lib/practice/sources";
import type { Notebook } from "@/lib/workspace/notebooks";
import { db } from "@/services/firebase/client";
import {
  getGeneratedContentDrafts,
  type GeneratedContentDraft,
} from "@/services/study/generated-content";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActiveSources } from "@/services/study/sources";
import { createOrGetTopic, getActiveTopics } from "@/services/study/topics";

export default function TopicsPage() {
  const router = useRouter();
  const { user, isDemoUser } = useUser();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [search, setSearch] = useState("");
  const [newTopicName, setNewTopicName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [nextTopics, cardSnapshot, nextNotebooks, nextSources, nextDrafts] =
        await Promise.all([
          getActiveTopics(user.uid),
          getDocs(query(collection(db, "cards"), where("userId", "==", user.uid))),
          getActiveNotebooks(user.uid),
          getActiveSources(user.uid),
          getGeneratedContentDrafts(user.uid),
        ]);
      setTopics(nextTopics);
      setCards(
        cardSnapshot.docs.map((snapshot) =>
          mapCardData(snapshot.id, snapshot.data() as Record<string, unknown>)
        )
      );
      setNotebooks(nextNotebooks);
      setSources(nextSources);
      setDrafts(nextDrafts);
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Could not load Topics." });
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const summaries = useMemo(
    () => buildTopicSummaries({ topics, cards, notebooks, sources, drafts }),
    [cards, drafts, notebooks, sources, topics]
  );
  const filtered = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    return queryText
      ? summaries.filter((summary) => summary.topic.name.toLowerCase().includes(queryText))
      : summaries;
  }, [search, summaries]);

  const createTopic = async () => {
    if (!newTopicName.trim() || isDemoUser) return;
    setCreating(true);
    setFeedback(null);
    try {
      const topic = await createOrGetTopic(user.uid, newTopicName);
      setTopics((current) =>
        current.some((item) => item.id === topic.id)
          ? current
          : [...current, topic]
      );
      setNewTopicName("");
      setFeedback({ type: "success", message: `${topic.name} is ready.` });
      router.push(`/dashboard/topics/${encodeURIComponent(topic.id)}`);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not create Topic.",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppPage
      title="Topics"
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

      <Card tone="warm" padding="lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Topics
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">
              Connect your study material
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
              Topics bring related cards, notebooks, sources, and drafts together.
            </p>
          </div>
          {!isDemoUser ? (
            <div className="flex w-full max-w-lg gap-2">
              <Input
                aria-label="New Topic name"
                placeholder="New Topic"
                value={newTopicName}
                onChange={(event) => setNewTopicName(event.target.value)}
                containerClassName="min-w-0 flex-1"
              />
              <Button
                type="button"
                disabled={creating || !newTopicName.trim()}
                onClick={() => void createTopic()}
              >
                {creating ? "Creating..." : "Create"}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {topics.length > 0 ? (
        <Input
          aria-label="Search Topics"
          placeholder="Search Topics"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((summary) => (
            <Link
              key={summary.topic.id}
              href={`/dashboard/topics/${encodeURIComponent(summary.topic.id)}`}
              className="app-panel group block rounded-[1.35rem] p-5 transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 truncate text-lg font-semibold text-text-primary">
                  {summary.topic.name}
                </h2>
                <span className="app-chip rounded-full px-2.5 py-1 text-xs font-semibold">
                  {summary.cardCount + summary.notebookCount + summary.sourceCount + summary.draftCount}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-text-muted">
                <span>{summary.cardCount} cards</span>
                <span>{summary.notebookCount} notebooks</span>
                <span>{summary.sourceCount} sources</span>
                <span>{summary.draftCount} drafts</span>
              </div>
              {(summary.dueCardCount > 0 || summary.weakCardCount > 0) ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {summary.dueCardCount > 0 ? (
                    <span className="app-chip rounded-full px-2.5 py-1 text-xs font-semibold">
                      {summary.dueCardCount} due
                    </span>
                  ) : null}
                  {summary.weakCardCount > 0 ? (
                    <span className="rounded-full border border-[var(--color-error-border)] bg-[var(--color-error-muted)] px-2.5 py-1 text-xs font-semibold text-[var(--color-error-text)]">
                      {summary.weakCardCount} weak
                    </span>
                  ) : null}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      ) : topics.length > 0 ? (
        <EmptyState
          emoji="Search"
          title="No Topics match"
          description="Try a shorter Topic name."
        />
      ) : (
        <EmptyState
          emoji="Topics"
          title="Create your first Topic"
          description="Topics connect related cards, notebooks, sources, and drafts."
        />
      )}
    </AppPage>
  );
}
