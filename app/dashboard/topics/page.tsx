"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
  Input,
  Skeleton,
} from "@/components/ui";
import { useUser } from "@/lib/auth/user-context";
import { sortByCreatedAtNewest } from "@/lib/app/recent-items";
import { buildTopicSummaries } from "@/lib/practice/topic-management";
import { getTopicNameKey, type Topic } from "@/lib/practice/topics";
import {
  shouldShowSmartSearchResults,
  textMatchesSmartSearch,
} from "@/lib/study/card-search";
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
import {
  createOrGetTopic,
  deleteTopicEverywhere,
  getActiveTopics,
  updateTopic,
} from "@/services/study/topics";

const RECENT_TOPIC_COUNT = 3;
const TOPIC_BROWSE_PAGE_SIZE = 30;

export default function TopicsPage() {
  const router = useRouter();
  const { user, isDemoUser } = useUser();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [search, setSearch] = useState("");
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [visibleTopicLimit, setVisibleTopicLimit] = useState(
    TOPIC_BROWSE_PAGE_SIZE
  );
  const [newTopicName, setNewTopicName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingTopicId, setSavingTopicId] = useState<string | null>(null);
  const [topicPendingDelete, setTopicPendingDelete] = useState<Topic | null>(null);
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null);
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
  const hasSearchQuery = shouldShowSmartSearchResults(search);
  const recentSummaries = useMemo(
    () =>
      sortByCreatedAtNewest(summaries, (summary) => summary.topic.createdAt),
    [summaries]
  );
  const filtered = useMemo(() => {
    if (!hasSearchQuery) return [];
    return summaries.filter((summary) =>
      textMatchesSmartSearch(summary.topic.name, search)
    );
  }, [hasSearchQuery, search, summaries]);
  const visibleSummaries = hasSearchQuery
    ? filtered
    : recentSummaries.slice(
        0,
        showAllTopics ? visibleTopicLimit : RECENT_TOPIC_COUNT
      );
  const remainingTopics = Math.max(
    recentSummaries.length - visibleSummaries.length,
    0
  );

  useEffect(() => {
    setVisibleTopicLimit(TOPIC_BROWSE_PAGE_SIZE);
  }, [topics.length]);

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

  const startRenaming = (topic: Topic) => {
    setEditingTopicId(topic.id);
    setRenameValue(topic.name);
    setFeedback(null);
  };

  const cancelRenaming = () => {
    setEditingTopicId(null);
    setRenameValue("");
  };

  const saveTopicName = async (topic: Topic) => {
    const nextName = renameValue.trim();
    if (!nextName || isDemoUser) return;
    setSavingTopicId(topic.id);
    setFeedback(null);
    try {
      await updateTopic(user.uid, topic.id, { name: nextName });
      setTopics((current) =>
        current.map((item) =>
          item.id === topic.id
            ? {
                ...item,
                name: nextName,
                normalizedName: getTopicNameKey(nextName),
                updatedAt: Date.now(),
              }
            : item
        )
      );
      cancelRenaming();
      setFeedback({ type: "success", message: "Topic renamed." });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "Could not rename Topic.",
      });
    } finally {
      setSavingTopicId(null);
    }
  };

  const deleteTopic = async () => {
    if (!topicPendingDelete || isDemoUser) return;
    const topic = topicPendingDelete;
    setDeletingTopicId(topic.id);
    setFeedback(null);
    try {
      await deleteTopicEverywhere(user.uid, topic.id);
      setTopics((current) => current.filter((item) => item.id !== topic.id));
      if (editingTopicId === topic.id) cancelRenaming();
      setTopicPendingDelete(null);
      setFeedback({ type: "success", message: `${topic.name} was deleted.` });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "Could not delete Topic.",
      });
    } finally {
      setDeletingTopicId(null);
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
      <ConfirmDialog
        open={topicPendingDelete !== null}
        title={
          topicPendingDelete
            ? `Delete ${topicPendingDelete.name}?`
            : "Delete Topic?"
        }
        description="This permanently removes the Topic from every linked card, notebook, source, and draft. Your study material will not be deleted."
        confirmLabel="Delete Topic"
        busy={
          topicPendingDelete !== null &&
          deletingTopicId === topicPendingDelete.id
        }
        onClose={() => setTopicPendingDelete(null)}
        onConfirm={() => void deleteTopic()}
      />

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
          onChange={(event) => {
            setSearch(event.target.value);
            if (editingTopicId) cancelRenaming();
          }}
        />
      ) : null}

      {!loading && topics.length > 0 && !hasSearchQuery ? (
        <div
          id="recent-topics"
          className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              Recently added
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              {showAllTopics
                ? "All Topics, newest to oldest"
                : `Your latest ${Math.min(RECENT_TOPIC_COUNT, topics.length)} Topics`}
            </p>
          </div>
          {topics.length > RECENT_TOPIC_COUNT ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={showAllTopics}
              aria-controls="recent-topics-grid"
              onClick={() => setShowAllTopics((current) => !current)}
              className="w-full sm:w-auto"
            >
              {showAllTopics ? "Show less" : "View more"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : visibleSummaries.length > 0 ? (
        <>
          <div
            id={!hasSearchQuery ? "recent-topics-grid" : undefined}
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {visibleSummaries.map((summary) => {
              const editing = editingTopicId === summary.topic.id;
              return (
                <section
                  key={summary.topic.id}
                  className="app-panel relative rounded-[1.35rem] transition duration-fast hover:-translate-y-0.5 hover:border-border-strong hover:shadow-shell"
                >
                  {editing ? (
                    <div className="p-5">
                      <Input
                        label="Topic name"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        disabled={savingTopicId === summary.topic.id}
                      />
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            savingTopicId === summary.topic.id ||
                            !renameValue.trim()
                          }
                          onClick={() => void saveTopicName(summary.topic)}
                        >
                          {savingTopicId === summary.topic.id
                            ? "Saving..."
                            : "Save Topic"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={savingTopicId === summary.topic.id}
                          onClick={cancelRenaming}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Link
                        href={`/dashboard/topics/${encodeURIComponent(summary.topic.id)}`}
                        className="group block rounded-[1.35rem] p-5 pr-16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h2 className="min-w-0 truncate text-lg font-semibold text-text-primary">
                            {summary.topic.name}
                          </h2>
                          <span className="app-chip rounded-full px-2.5 py-1 text-xs font-semibold">
                            {summary.cardCount +
                              summary.notebookCount +
                              summary.sourceCount +
                              summary.draftCount}
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-text-muted">
                          <span>{summary.cardCount} cards</span>
                          <span>{summary.notebookCount} notebooks</span>
                          <span>{summary.sourceCount} sources</span>
                          <span>{summary.draftCount} drafts</span>
                        </div>
                        {summary.dueCardCount > 0 ||
                        summary.weakCardCount > 0 ? (
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
                      {!isDemoUser ? (
                        <details className="group/menu absolute right-3 top-3">
                          <summary
                            aria-label={`Actions for ${summary.topic.name}`}
                            className="app-chip flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden"
                          >
                            <svg
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              aria-hidden="true"
                              className="h-5 w-5"
                            >
                              <circle cx="4" cy="10" r="1.6" />
                              <circle cx="10" cy="10" r="1.6" />
                              <circle cx="16" cy="10" r="1.6" />
                            </svg>
                          </summary>
                          <div className="absolute right-0 top-12 z-30 min-w-44 overflow-hidden rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1.5 shadow-[0_18px_46px_rgba(0,0,0,0.28)]">
                            <button
                              type="button"
                              className="flex w-full items-center rounded-[0.75rem] px-3 py-2 text-left text-sm font-medium text-text-primary transition hover:bg-[var(--color-glass-subtle)]"
                              onClick={(event) => {
                                event.currentTarget
                                  .closest("details")
                                  ?.removeAttribute("open");
                                startRenaming(summary.topic);
                              }}
                            >
                              Rename Topic
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center rounded-[0.75rem] px-3 py-2 text-left text-sm font-semibold text-error transition hover:bg-[var(--color-error-muted)]"
                              onClick={(event) => {
                                event.currentTarget
                                  .closest("details")
                                  ?.removeAttribute("open");
                                setTopicPendingDelete(summary.topic);
                              }}
                            >
                              Delete Topic
                            </button>
                          </div>
                        </details>
                      ) : null}
                    </>
                  )}
                </section>
              );
            })}
          </div>
          {!hasSearchQuery && showAllTopics && remainingTopics > 0 ? (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setVisibleTopicLimit(
                    (limit) => limit + TOPIC_BROWSE_PAGE_SIZE
                  )
                }
                className="w-full sm:w-auto"
              >
                Show {Math.min(TOPIC_BROWSE_PAGE_SIZE, remainingTopics)} more
              </Button>
            </div>
          ) : null}
        </>
      ) : topics.length > 0 && hasSearchQuery ? (
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
