"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
  IconBubble,
  Input,
  Skeleton,
} from "@/components/ui";
import { useAdaptiveMenuPlacement } from "@/components/ui/useAdaptiveMenuPlacement";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import { buildTopicSummaries } from "@/lib/material/topic-management";
import type { Source } from "@/lib/material/sources";
import { MAX_LINKED_TOPICS, type Topic } from "@/lib/material/topics";
import type { Card as StudyCard } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import { loadUserCards, updateCardTopics } from "@/services/study/cards";
import type { Notebook } from "@/lib/workspace/notebooks";
import { getDecks } from "@/services/study/decks";
import {
  getGeneratedContentDrafts,
  updateGeneratedContentDraftContent,
} from "@/services/study/generated-content";
import { getActiveNotebooks, updateNotebook } from "@/services/study/notebooks";
import { getActiveSources, updateSource } from "@/services/study/sources";
import {
  deleteTopicEverywhere,
  getActiveTopics,
  updateTopic,
} from "@/services/study/topics";
import {
  useDashboardData,
  type DashboardDataLoadOptions,
} from "@/hooks/useDashboardData";

type TopicSection = "cards" | "notebooks" | "sources" | "drafts";

/**
 * One row of one of the four things a Topic can hold.
 *
 * The four kinds differ only in where they live and how they are saved, so the
 * page builds them into a single shape and renders one list rather than four
 * near-identical ones.
 */
type TopicItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  linked: boolean;
  busyKey: string;
  toggle: () => void;
};

const SECTIONS: {
  id: TopicSection;
  label: string;
  /** Used in "Add cards", "No cards in this Topic yet", and similar copy. */
  plural: string;
}[] = [
  { id: "cards", label: "Cards", plural: "cards" },
  { id: "notebooks", label: "Notebooks", plural: "notebooks" },
  { id: "sources", label: "Sources", plural: "sources" },
  { id: "drafts", label: "Drafts", plural: "drafts" },
];

/**
 * How many unlinked items the picker shows before asking the student to search.
 *
 * The page holds every card in the workspace in memory, and the list used to
 * put all of them on screen at once -- so opening a Topic named "Enzymes"
 * showed hundreds of rows that had nothing to do with enzymes.
 */
const PICKER_RESULT_LIMIT = 25;

function addOrRemoveTopic(topicIds: string[], topicId: string, linked: boolean) {
  return linked
    ? Array.from(new Set([...topicIds, topicId]))
    : topicIds.filter((id) => id !== topicId);
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function TopicManageMenu({
  onRename,
  onDelete,
}: {
  onRename: () => void;
  onDelete: () => void;
}) {
  const { handleToggle, menuPositionClass } = useAdaptiveMenuPlacement(110);

  return (
    <details className="relative shrink-0" onToggle={handleToggle}>
      <summary className="app-button-secondary inline-flex min-h-[2.25rem] cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Manage
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="h-3 w-3"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <div
        className={`absolute right-0 z-30 min-w-44 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1.5 shadow-e3 ${menuPositionClass}`}
      >
        <button
          type="button"
          className="flex w-full items-center rounded-sm px-3 py-2 text-left text-sm font-medium text-text-primary transition hover:bg-[var(--color-glass-subtle)]"
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            onRename();
          }}
        >
          Rename Topic
        </button>
        <button
          type="button"
          className="flex w-full items-center rounded-sm px-3 py-2 text-left text-sm font-semibold text-error transition hover:bg-[var(--color-error-muted)]"
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            onDelete();
          }}
        >
          Delete Topic
        </button>
      </div>
    </details>
  );
}

function TopicItemRow({
  item,
  topicName,
  busy,
  action,
}: {
  item: TopicItem;
  topicName: string;
  busy: boolean;
  action: "add" | "remove";
}) {
  return (
    <li className="app-subtle-panel flex items-center gap-2 rounded-lg py-1.5 pl-3 pr-1.5">
      <Link
        href={item.href}
        className="min-w-0 flex-1 rounded-sm py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="block truncate text-sm font-medium text-text-primary">
          {item.title}
        </span>
        <span className="mt-0.5 block truncate text-2xs text-text-muted">
          {item.detail}
        </span>
      </Link>
      <Button
        type="button"
        size="sm"
        variant={action === "add" ? "secondary" : "ghost"}
        disabled={busy}
        aria-label={
          action === "add"
            ? `Add ${item.title} to ${topicName}`
            : `Remove ${item.title} from ${topicName}`
        }
        onClick={item.toggle}
      >
        {action === "add" ? "Add" : "Remove"}
      </Button>
    </li>
  );
}

export default function TopicDetailPage() {
  const params = useParams<{ topicId: string }>();
  const router = useRouter();
  const { user } = useUser();
  const topicId = params.topicId;
  const [topics, setTopics] = useState<Topic[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [section, setSection] = useState<TopicSection>("cards");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const {
    feedback,
    success,
    showError,
    showThrownError,
    clear: clearFeedback,
  } = useFeedback();

  const loadTopicData = useCallback(async (reads: DashboardDataLoadOptions = {}) => {
    const [nextTopics, nextCards, nextDecks, nextNotebooks, nextSources, nextDrafts] =
      await Promise.all([
        getActiveTopics(user.uid, reads),
        loadUserCards(user.uid, reads),
        getDecks(user.uid, reads),
        getActiveNotebooks(user.uid, reads),
        getActiveSources(user.uid, reads),
        getGeneratedContentDrafts(user.uid, reads),
      ]);
    return {
      topics: nextTopics,
      cards: nextCards,
      decks: nextDecks,
      notebooks: nextNotebooks,
      sources: nextSources,
      drafts: nextDrafts,
    };
  }, [user.uid]);

  const applyTopicData = useCallback(
    (data: Awaited<ReturnType<typeof loadTopicData>>) => {
      setLoadFailed(false);
      setTopics(data.topics);
      setCards(data.cards);
      setDecks(data.decks);
      setNotebooks(data.notebooks);
      setSources(data.sources);
      setDrafts(data.drafts);
    },
    []
  );

  const handleTopicLoadError = useCallback((error: unknown) => {
    console.error("Failed to load a Topic and its linked workspace data.", error);
    setLoadFailed(true);
    showError("Could not load this Topic.");
  }, [showError]);

  const { loading, reload } = useDashboardData({
    requestKey: user.uid,
    load: loadTopicData,
    apply: applyTopicData,
    onError: handleTopicLoadError,
  });

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

  const sectionCounts = useMemo(
    () => ({
      cards: summary?.cardCount ?? 0,
      notebooks: summary?.notebookCount ?? 0,
      sources: summary?.sourceCount ?? 0,
      drafts: summary?.draftCount ?? 0,
    }),
    [summary]
  );

  /*
   * Open on a tab that has something in it. A Topic collected from notebook
   * work has no cards yet, and landing on an empty Cards list reads as "this
   * Topic is empty" when it is not. Runs once, so it never overrides a tab the
   * student has since chosen.
   */
  const openingTabChosen = useRef(false);
  useEffect(() => {
    if (loading || openingTabChosen.current || !summary) return;
    openingTabChosen.current = true;
    const firstFilled = SECTIONS.find((item) => sectionCounts[item.id] > 0);
    if (firstFilled) setSection(firstFilled.id);
  }, [loading, sectionCounts, summary]);

  const selectSection = (next: TopicSection) => {
    setSection(next);
    setPickerOpen(false);
    setSearch("");
  };

  const saveName = async () => {
    if (!topic || !renameValue.trim()) return;
    setBusyId("rename");
    try {
      await updateTopic(user.uid, topic.id, { name: renameValue });
      setTopics((current) =>
        current.map((item) =>
          item.id === topic.id ? { ...item, name: renameValue.trim() } : item
        )
      );
      setEditingName(false);
      success("Topic renamed.");
    } catch (error) {
      showThrownError(error, "Could not rename Topic.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleCard = async (card: StudyCard) => {
    const linked = card.topicIds?.includes(topicId) ?? false;
    if (!linked && (card.topicIds?.length ?? 0) >= MAX_LINKED_TOPICS) {
      showError("This card already has five Topics. Remove one before adding another.");
      return;
    }
    const topicIds = addOrRemoveTopic(card.topicIds ?? [], topicId, !linked);
    setBusyId(`card:${card.id}`);
    try {
      await updateCardTopics(card.id, topicIds);
      setCards((current) =>
        current.map((item) => (item.id === card.id ? { ...item, topicIds, tags: [] } : item))
      );
    } catch (error) {
      showThrownError(error, "Could not update this card.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleNotebook = async (notebook: Notebook) => {
    const linked = notebook.topicIds.includes(topicId);
    if (!linked && notebook.topicIds.length >= MAX_LINKED_TOPICS) {
      showError("This notebook already has five Topics. Remove one before adding another.");
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
      showThrownError(error, "Could not update this notebook.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleSource = async (source: Source) => {
    const linked = source.topicIds.includes(topicId);
    if (!linked && source.topicIds.length >= MAX_LINKED_TOPICS) {
      showError("This source already has five Topics. Remove one before adding another.");
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
      showThrownError(error, "Could not update this source.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleDraft = async (draft: GeneratedContentDraft) => {
    const linked = draft.topicIds.includes(topicId);
    if (!linked && draft.topicIds.length >= MAX_LINKED_TOPICS) {
      showError("This draft already has five Topics. Remove one before adding another.");
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
      showThrownError(error, "Could not update this draft.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteTopic = async () => {
    if (!topic) return;
    setBusyId("delete");
    try {
      await deleteTopicEverywhere(user.uid, topic.id);
      router.push("/dashboard/topics");
    } catch (error) {
      showThrownError(error, "Could not delete Topic.");
      setBusyId(null);
      setDeleteOpen(false);
    }
  };

  if (loading) {
    return (
      <AppPage
        title="Topic"
        backHref="/dashboard/topics"
        backLabel="Topics"
        width="lg"
        contentClassName="space-y-4"
      >
        <Skeleton className="h-28" />
        <Skeleton className="h-11" />
        <Skeleton className="h-64" />
      </AppPage>
    );
  }

  if (loadFailed) {
    return (
      <AppPage title="Topic" backHref="/dashboard/topics" backLabel="Topics" width="lg">
        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onDismiss={() => clearFeedback()}
          />
        ) : null}
        <EmptyState
          emoji="Topic"
          title="This Topic could not load"
          description="Your workspace data has not been replaced with empty results. Try loading it again."
          action={
            <Button type="button" onClick={() => void reload()}>
              Try again
            </Button>
          }
        />
      </AppPage>
    );
  }

  if (!topic || !summary) {
    return (
      <AppPage title="Topic" backHref="/dashboard/topics" backLabel="Topics" width="lg">
        <EmptyState
          emoji="Topic"
          title="Topic not found"
          description="It may have been deleted."
        />
      </AppPage>
    );
  }

  const activeSection = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
  const normalizedSearch = search.trim().toLowerCase();
  const initial = Array.from(topic.name.trim())[0]?.toUpperCase() ?? "T";

  const holdings = [
    countLabel(summary.cardCount, "card"),
    countLabel(summary.notebookCount, "notebook"),
    countLabel(summary.sourceCount, "source"),
    countLabel(summary.draftCount, "draft"),
  ];
  const hasAnyMaterial =
    summary.cardCount + summary.notebookCount + summary.sourceCount + summary.draftCount >
    0;

  const buildItems = (): TopicItem[] => {
    if (section === "cards") {
      return cards.map((item) => ({
        id: item.id,
        title: item.front,
        detail: deckNames[item.deckId] ?? "Card",
        href: `/dashboard/decks/${encodeURIComponent(item.deckId)}`,
        linked: item.topicIds?.includes(topicId) ?? false,
        busyKey: `card:${item.id}`,
        toggle: () => void toggleCard(item),
      }));
    }
    if (section === "notebooks") {
      return notebooks.map((item) => ({
        id: item.id,
        title: item.title,
        detail: "Notebook",
        href: `/dashboard/notebooks/${encodeURIComponent(item.id)}`,
        linked: item.topicIds.includes(topicId),
        busyKey: `notebook:${item.id}`,
        toggle: () => void toggleNotebook(item),
      }));
    }
    if (section === "sources") {
      return sources.map((item) => ({
        id: item.id,
        title: item.title,
        detail: "Saved source",
        href: `/dashboard/library?source=${encodeURIComponent(item.id)}`,
        linked: item.topicIds.includes(topicId),
        busyKey: `source:${item.id}`,
        toggle: () => void toggleSource(item),
      }));
    }
    return drafts
      .filter((item) => item.contentStatus === "draft")
      .map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.kind === "flashcard" ? "Flashcard draft" : "Notebook draft",
        href: "/dashboard/library",
        linked: item.topicIds.includes(topicId),
        busyKey: `draft:${item.id}`,
        toggle: () => void toggleDraft(item),
      }));
  };

  const allItems = buildItems();
  const linkedItems = allItems.filter((item) => item.linked);
  const matchesSearch = (item: TopicItem) =>
    section === "cards"
      ? `${item.title} ${item.detail}`.toLowerCase().includes(normalizedSearch)
      : item.title.toLowerCase().includes(normalizedSearch);
  const unlinkedMatches = allItems.filter(
    (item) => !item.linked && (!normalizedSearch || matchesSearch(item))
  );
  const pickerItems = unlinkedMatches.slice(0, PICKER_RESULT_LIMIT);
  const hiddenMatches = unlinkedMatches.length - pickerItems.length;

  return (
    <AppPage
      title={topic.name}
      backHref="/dashboard/topics"
      backLabel="Topics"
      width="lg"
      contentClassName="space-y-4"
    >
      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => clearFeedback()}
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

      {/*
       * Which Topic you are in, and nothing else. The counts that used to fill
       * six stat tiles and a separate "Study health" card are one quiet line
       * here -- they are context for the name, not a dashboard of their own.
       */}
      <Card tone="warm" padding="md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <IconBubble
              size="lg"
              aria-hidden
              className="app-chip mt-0.5 font-semibold uppercase"
            >
              {initial}
            </IconBubble>
            <div className="min-w-0">
              <p className="text-2xs font-semibold uppercase tracking-[0.2em] text-text-muted">
                Topic
              </p>
              {editingName ? (
                <div className="mt-2 flex max-w-md flex-wrap gap-2">
                  <Input
                    aria-label="Topic name"
                    value={renameValue}
                    className="rounded-full px-4 py-2.5"
                    containerClassName="min-w-0 flex-1"
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
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busyId === "rename"}
                    onClick={() => setEditingName(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <h2 className="mt-0.5 break-words text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">
                  {topic.name}
                </h2>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-2xs text-text-muted">
                <span>
                  {hasAnyMaterial
                    ? holdings.join(" · ")
                    : "Nothing linked to this Topic yet"}
                </span>
                {summary.dueCardCount > 0 ? (
                  <span className="app-chip rounded-full px-2.5 py-0.5 font-semibold">
                    {summary.dueCardCount} due
                  </span>
                ) : null}
                {summary.weakCardCount > 0 ? (
                  <span className="rounded-full border border-[var(--color-error-border)] bg-[var(--color-error-muted)] px-2.5 py-0.5 font-semibold text-[var(--color-error-text)]">
                    {summary.weakCardCount} weak
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:justify-end">
            {summary.cardCount > 0 ? (
              <ButtonLink
                size="sm"
                className="rounded-full"
                href={`/dashboard/study?mode=custom&topics=${encodeURIComponent(topic.id)}`}
              >
                Review cards
              </ButtonLink>
            ) : null}
            <TopicManageMenu
              onRename={() => {
                setRenameValue(topic.name);
                setEditingName(true);
              }}
              onDelete={() => setDeleteOpen(true)}
            />
          </div>
        </div>
      </Card>

      <div className="scrollbar-hide flex gap-1 overflow-x-auto rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-1">
        {SECTIONS.map((item) => {
          const selected = item.id === section;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              onClick={() => selectSection(item.id)}
              className={`inline-flex min-h-[2.3rem] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition duration-fast ${
                selected
                  ? "bg-accent text-[var(--color-text-inverse)] shadow-accent"
                  : "text-text-secondary hover:bg-[var(--color-glass-medium)] hover:text-text-primary"
              }`}
            >
              {item.label}
              <span
                className={`rounded-full px-1.5 py-px text-2xs font-semibold tabular-nums ${
                  selected ? "opacity-75" : "app-chip"
                }`}
              >
                {sectionCounts[item.id]}
              </span>
            </button>
          );
        })}
      </div>

      <Card padding="md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-medium tracking-tight text-text-primary">
            {activeSection.label} in this Topic
          </h3>
          <Button
            type="button"
            size="sm"
            variant={pickerOpen ? "ghost" : "secondary"}
            aria-expanded={pickerOpen}
            onClick={() => {
              setPickerOpen((open) => !open);
              setSearch("");
            }}
          >
            {pickerOpen ? "Done" : `Add ${activeSection.plural}`}
          </Button>
        </div>

        {/*
         * Everything the student does not already have in this Topic lives
         * behind this one button. It used to share the list with the Topic's
         * own material, which is why opening a Topic showed the whole
         * workspace.
         */}
        {pickerOpen ? (
          <div className="app-subtle-panel mt-4 rounded-xl p-3">
            <Input
              aria-label={`Search ${activeSection.plural} to add`}
              placeholder={`Search your ${activeSection.plural}`}
              value={search}
              className="rounded-full px-4 py-2.5"
              onChange={(event) => setSearch(event.target.value)}
            />
            {pickerItems.length > 0 ? (
              <>
                <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {pickerItems.map((item) => (
                    <TopicItemRow
                      key={item.id}
                      item={item}
                      topicName={topic.name}
                      busy={busyId === item.busyKey}
                      action="add"
                    />
                  ))}
                </ul>
                {hiddenMatches > 0 ? (
                  <p className="mt-2.5 text-2xs text-text-muted">
                    {hiddenMatches} more {activeSection.plural} not shown. Search to
                    narrow this down.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-text-muted">
                {normalizedSearch
                  ? `No other ${activeSection.plural} match that search.`
                  : `Every one of your ${activeSection.plural} is already in this Topic.`}
              </p>
            )}
          </div>
        ) : null}

        {linkedItems.length > 0 ? (
          <ul className="mt-4 max-h-[32rem] space-y-1.5 overflow-y-auto pr-1">
            {linkedItems.map((item) => (
              <TopicItemRow
                key={item.id}
                item={item}
                topicName={topic.name}
                busy={busyId === item.busyKey}
                action="remove"
              />
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <EmptyState
              variant="plain"
              align="left"
              title={`No ${activeSection.plural} in this Topic yet`}
              description={`Add ${activeSection.plural} you are already working on and they will gather here.`}
            />
          </div>
        )}
      </Card>
    </AppPage>
  );
}
