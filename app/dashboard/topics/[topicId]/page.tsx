"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
  Input,
  SectionHeader,
  Skeleton,
  StatTile,
} from "@/components/ui";
import { useUser } from "@/lib/auth/user-context";
import { buildTopicSummaries } from "@/lib/practice/topic-management";
import type { Source } from "@/lib/practice/sources";
import { MAX_LINKED_TOPICS, type Topic } from "@/lib/practice/topics";
import { mapCardData, type Card as StudyCard } from "@/lib/study/cards";
import type { Notebook } from "@/lib/workspace/notebooks";
import { db } from "@/services/firebase/client";
import { getDecks, type Deck } from "@/services/study/decks";
import {
  getGeneratedContentDrafts,
  updateGeneratedContentDraftContent,
  type GeneratedContentDraft,
} from "@/services/study/generated-content";
import { getActiveNotebooks, updateNotebook } from "@/services/study/notebooks";
import { getActiveSources, updateSource } from "@/services/study/sources";
import {
  deleteTopicEverywhere,
  getActiveTopics,
  updateTopic,
} from "@/services/study/topics";

type TopicSection = "overview" | "cards" | "notebooks" | "sources" | "drafts";

function addOrRemoveTopic(topicIds: string[], topicId: string, linked: boolean) {
  return linked
    ? Array.from(new Set([...topicIds, topicId]))
    : topicIds.filter((id) => id !== topicId);
}

export default function TopicDetailPage() {
  const params = useParams<{ topicId: string }>();
  const router = useRouter();
  const { user, isDemoUser } = useUser();
  const topicId = params.topicId;
  const [topics, setTopics] = useState<Topic[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [section, setSection] = useState<TopicSection>("overview");
  const [search, setSearch] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [nextTopics, cardSnapshot, nextDecks, nextNotebooks, nextSources, nextDrafts] =
        await Promise.all([
          getActiveTopics(user.uid),
          getDocs(query(collection(db, "cards"), where("userId", "==", user.uid))),
          getDecks(user.uid),
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
      setDecks(nextDecks);
      setNotebooks(nextNotebooks);
      setSources(nextSources);
      setDrafts(nextDrafts);
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Could not load this Topic." });
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const topic = topics.find((item) => item.id === topicId) ?? null;
  const summary = useMemo(
    () =>
      buildTopicSummaries({ topics, cards, notebooks, sources, drafts }).find(
        (item) => item.topic.id === topicId
      ) ?? null,
    [cards, drafts, notebooks, sources, topicId, topics]
  );
  const deckNames = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.name])),
    [decks]
  );
  const normalizedSearch = search.trim().toLowerCase();
  const linkedCards = cards.filter((item) => item.topicIds?.includes(topicId));
  const linkedNotebooks = notebooks.filter((item) => item.topicIds.includes(topicId));
  const linkedSources = sources.filter((item) => item.topicIds.includes(topicId));
  const linkedDrafts = drafts.filter(
    (item) => item.contentStatus === "draft" && item.topicIds.includes(topicId)
  );

  const saveName = async () => {
    if (!topic || !renameValue.trim() || isDemoUser) return;
    setBusyId("rename");
    try {
      await updateTopic(user.uid, topic.id, { name: renameValue });
      setTopics((current) =>
        current.map((item) =>
          item.id === topic.id ? { ...item, name: renameValue.trim() } : item
        )
      );
      setEditingName(false);
      setFeedback({ type: "success", message: "Topic renamed." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not rename Topic.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const toggleCard = async (card: StudyCard) => {
    const linked = card.topicIds?.includes(topicId) ?? false;
    if (!linked && (card.topicIds?.length ?? 0) >= MAX_LINKED_TOPICS) {
      setFeedback({ type: "error", message: "This card already has five Topics. Remove one before adding another." });
      return;
    }
    const topicIds = addOrRemoveTopic(card.topicIds ?? [], topicId, !linked);
    setBusyId(`card:${card.id}`);
    try {
      await updateDoc(doc(db, "cards", card.id), { topicIds, tags: [] });
      setCards((current) =>
        current.map((item) => (item.id === card.id ? { ...item, topicIds, tags: [] } : item))
      );
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not update this card.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const toggleNotebook = async (notebook: Notebook) => {
    const linked = notebook.topicIds.includes(topicId);
    if (!linked && notebook.topicIds.length >= MAX_LINKED_TOPICS) {
      setFeedback({ type: "error", message: "This notebook already has five Topics. Remove one before adding another." });
      return;
    }
    const topicIds = addOrRemoveTopic(notebook.topicIds, topicId, !linked);
    setBusyId(`notebook:${notebook.id}`);
    try {
      await updateNotebook(user.uid, notebook.id, { topicIds });
      setNotebooks((current) =>
        current.map((item) => (item.id === notebook.id ? { ...item, topicIds } : item))
      );
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not update this notebook.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const toggleSource = async (source: Source) => {
    const linked = source.topicIds.includes(topicId);
    if (!linked && source.topicIds.length >= MAX_LINKED_TOPICS) {
      setFeedback({ type: "error", message: "This source already has five Topics. Remove one before adding another." });
      return;
    }
    const topicIds = addOrRemoveTopic(source.topicIds, topicId, !linked);
    setBusyId(`source:${source.id}`);
    try {
      await updateSource(user.uid, source.id, { topicIds });
      setSources((current) =>
        current.map((item) => (item.id === source.id ? { ...item, topicIds } : item))
      );
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not update this source.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const toggleDraft = async (draft: GeneratedContentDraft) => {
    const linked = draft.topicIds.includes(topicId);
    if (!linked && draft.topicIds.length >= MAX_LINKED_TOPICS) {
      setFeedback({ type: "error", message: "This draft already has five Topics. Remove one before adding another." });
      return;
    }
    const topicIds = addOrRemoveTopic(draft.topicIds, topicId, !linked);
    setBusyId(`draft:${draft.id}`);
    try {
      await updateGeneratedContentDraftContent(user.uid, draft.id, { topicIds });
      setDrafts((current) =>
        current.map((item) => (item.id === draft.id ? { ...item, topicIds } : item))
      );
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not update this draft.",
      });
    } finally {
      setBusyId(null);
    }
  };

  const deleteTopic = async () => {
    if (!topic || isDemoUser) return;
    setBusyId("delete");
    try {
      await deleteTopicEverywhere(user.uid, topic.id);
      router.push("/dashboard/topics");
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not delete Topic.",
      });
      setBusyId(null);
      setDeleteOpen(false);
    }
  };

  if (loading) {
    return (
      <AppPage title="Topic" backHref="/dashboard/topics" backLabel="Topics">
        <Skeleton className="h-56" />
      </AppPage>
    );
  }

  if (!topic || !summary) {
    return (
      <AppPage title="Topic" backHref="/dashboard/topics" backLabel="Topics">
        <EmptyState
          emoji="Topic"
          title="Topic not found"
          description="It may have been deleted."
        />
      </AppPage>
    );
  }

  const sectionItems =
    section === "cards"
      ? cards
          .filter(
            (item) =>
              !normalizedSearch ||
              item.front.toLowerCase().includes(normalizedSearch) ||
              item.back.toLowerCase().includes(normalizedSearch)
          )
          .map((item) => ({
            id: item.id,
            title: item.front,
            detail: deckNames[item.deckId] ?? "Card",
            linked: item.topicIds?.includes(topicId) ?? false,
            href: `/dashboard/decks/${encodeURIComponent(item.deckId)}`,
            toggle: () => void toggleCard(item),
          }))
      : section === "notebooks"
        ? notebooks
            .filter((item) => !normalizedSearch || item.title.toLowerCase().includes(normalizedSearch))
            .map((item) => ({
              id: item.id,
              title: item.title,
              detail: "Notebook",
              linked: item.topicIds.includes(topicId),
              href: `/dashboard/notebooks/${encodeURIComponent(item.id)}`,
              toggle: () => void toggleNotebook(item),
            }))
        : section === "sources"
          ? sources
              .filter((item) => !normalizedSearch || item.title.toLowerCase().includes(normalizedSearch))
              .map((item) => ({
                id: item.id,
                title: item.title,
                detail: "Saved source",
                linked: item.topicIds.includes(topicId),
                href: `/dashboard/library?source=${encodeURIComponent(item.id)}`,
                toggle: () => void toggleSource(item),
              }))
          : section === "drafts"
            ? drafts
                .filter(
                  (item) =>
                    item.contentStatus === "draft" &&
                    (!normalizedSearch || item.title.toLowerCase().includes(normalizedSearch))
                )
                .map((item) => ({
                  id: item.id,
                  title: item.title,
                  detail: item.kind === "flashcard" ? "Flashcard draft" : "Notebook draft",
                  linked: item.topicIds.includes(topicId),
                  href: "/dashboard/library",
                  toggle: () => void toggleDraft(item),
                }))
            : [];

  return (
    <AppPage
      title={topic.name}
      backHref="/dashboard/topics"
      backLabel="Topics"
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
        open={deleteOpen}
        title={`Delete ${topic.name}?`}
        description="This permanently removes the Topic from every linked card, notebook, source, and draft. Your study material will not be deleted."
        confirmLabel="Delete Topic"
        busy={busyId === "delete"}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void deleteTopic()}
      />

      <Card tone="warm" padding="lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Topic
            </div>
            {editingName ? (
              <div className="mt-3 flex max-w-lg gap-2">
                <Input
                  aria-label="Topic name"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={busyId === "rename" || !renameValue.trim()}
                  onClick={() => void saveName()}
                >
                  Save
                </Button>
              </div>
            ) : (
              <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight text-text-primary">
                {topic.name}
              </h1>
            )}
          </div>
          {!isDemoUser ? (
            <details className="relative">
              <summary className="app-button-secondary inline-flex min-h-11 cursor-pointer list-none items-center rounded-full px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                Manage
              </summary>
              <div className="app-panel absolute right-0 top-[calc(100%+0.5rem)] z-30 grid min-w-48 gap-1 rounded-[1rem] p-2 shadow-shell">
                <button
                  type="button"
                  className="rounded-xl px-3 py-2 text-left text-sm text-text-secondary hover:bg-[var(--color-glass-subtle)]"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setRenameValue(topic.name);
                    setEditingName(true);
                  }}
                >
                  Rename Topic
                </button>
                <button
                  type="button"
                  className="rounded-xl px-3 py-2 text-left text-sm font-semibold text-[var(--color-error-text)] hover:bg-[var(--color-error-muted)]"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    setDeleteOpen(true);
                  }}
                >
                  Delete Topic
                </button>
              </div>
            </details>
          ) : null}
        </div>
      </Card>

      <Card padding="sm">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
            View
          </span>
          <select
            value={section}
            onChange={(event) => {
              setSection(event.target.value as TopicSection);
              setSearch("");
            }}
            className="app-field min-h-11 w-full rounded-full px-4 text-sm sm:max-w-xs"
          >
            <option value="overview">Overview</option>
            <option value="cards">Cards ({linkedCards.length})</option>
            <option value="notebooks">Notebooks ({linkedNotebooks.length})</option>
            <option value="sources">Sources ({linkedSources.length})</option>
            <option value="drafts">Drafts ({linkedDrafts.length})</option>
          </select>
        </label>
      </Card>

      {section === "overview" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile compact label="Cards" value={summary.cardCount} />
            <StatTile compact label="Notebooks" value={summary.notebookCount} />
            <StatTile compact label="Sources" value={summary.sourceCount} />
            <StatTile compact label="Drafts" value={summary.draftCount} />
          </div>
          <Card padding="md">
            <SectionHeader
              title="Study health"
              description="Only real card evidence is shown here."
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <StatTile compact label="Cards due" value={summary.dueCardCount} />
              <StatTile compact label="Weak cards" value={summary.weakCardCount} />
            </div>
            {summary.cardCount > 0 ? (
              <Link
                href={`/dashboard/study?mode=custom&topics=${encodeURIComponent(topic.id)}`}
                className="app-button-secondary mt-4 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium"
              >
                Review Topic cards
              </Link>
            ) : null}
          </Card>
        </>
      ) : (
        <Card padding="lg">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeader
              title={section[0].toUpperCase() + section.slice(1)}
              description="Search, open, or change which items belong to this Topic."
            />
            <Input
              aria-label={`Search ${section}`}
              placeholder={`Search ${section}`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              containerClassName="w-full sm:max-w-xs"
            />
          </div>
          <div className="mt-5 max-h-[34rem] space-y-2 overflow-y-auto pr-1">
            {sectionItems.length > 0 ? (
              sectionItems.map((item) => (
                <div
                  key={item.id}
                  className="app-subtle-panel flex items-center justify-between gap-3 rounded-[1rem] p-3"
                >
                  <Link href={item.href} className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text-primary">
                      {item.title}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">{item.detail}</div>
                  </Link>
                  {!isDemoUser ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={item.linked ? "ghost" : "secondary"}
                      disabled={busyId === `${section.slice(0, -1)}:${item.id}`}
                      onClick={item.toggle}
                    >
                      {item.linked ? "Remove" : "Add"}
                    </Button>
                  ) : null}
                </div>
              ))
            ) : (
              <EmptyState
                variant="plain"
                emoji="Search"
                title={`No ${section} found`}
                description="Try a shorter search."
              />
            )}
          </div>
        </Card>
      )}
    </AppPage>
  );
}
