"use client";

import { useEffect, useMemo, useState } from "react";
import { FirebaseError } from "firebase/app";
import { collection, deleteDoc, doc, getDocs, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { db } from "@/services/firebase/client";
import { getDecks, type Deck } from "@/services/study/decks";
import { getActiveSources } from "@/services/study/sources";
import { getActiveStudyFolders } from "@/services/study/folders";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import {
  frontMatchesCardSearch,
  shouldShowCardBrowserResults,
} from "@/lib/study/card-search";
import {
  buildCardBrowserSearch,
  getCardBrowserStateFromSearch,
} from "@/lib/study/card-browser-navigation";
import {
  getCardContentKey,
  mapCardData,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardContentInput,
  type Card,
} from "@/lib/study/cards";
import type { Source } from "@/lib/practice/sources";
import {
  getTopicNameKey,
  MAX_LINKED_TOPICS,
  type Topic,
} from "@/lib/practice/topics";
import { getBulkTopicCapacity } from "@/lib/practice/topic-management";
import { getCardContentDuplicateCounts, getCardQualityWarnings } from "@/lib/study/card-quality";
import { getDeckHref } from "@/lib/app/routes";
import { featureFlags } from "@/lib/app/feature-flags";
import { sortByCreatedAtNewest } from "@/lib/app/recent-items";
import { getActiveTopics } from "@/services/study/topics";
import AppPage from "@/components/layout/AppPage";
import CardCreationPanel from "@/components/decks/CardCreationPanel";
import CardActionsMenu from "@/components/decks/CardActionsMenu";
import CardFaceSummary from "@/components/decks/CardFaceSummary";
import BulkTopicToolbar from "@/components/topics/BulkTopicToolbar";
import TopicPicker from "@/components/topics/TopicPicker";
import CardQualityWarnings from "@/components/decks/CardQualityWarnings";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import CardDifficultyBadge from "@/components/study/CardDifficultyBadge";
import { useCardSelection } from "@/components/decks/useCardSelection";
import { Button, ConfirmDialog, EmptyState, FeedbackBanner, Input, Skeleton, StudyText } from "@/components/ui";
import Link from "next/link";

const CARD_RESULT_PAGE_SIZE = 50;
const RECENT_CARD_COUNT = 4;
type CardStatusFilter = "all" | "due" | "weak" | "new";

function isPermissionDenied(error: unknown) {
  return error instanceof FirebaseError && error.code === "permission-denied";
}

export default function CardsSearchPage() {
  const { user, isDemoUser } = useUser();

  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [visibleResultLimit, setVisibleResultLimit] = useState(CARD_RESULT_PAGE_SIZE);
  const [visibleBrowseLimit, setVisibleBrowseLimit] = useState(CARD_RESULT_PAGE_SIZE);
  const [showAllCards, setShowAllCards] = useState(false);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [deckFilter, setDeckFilter] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [legacyTagFilter, setLegacyTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<CardStatusFilter>("all");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [editingFront, setEditingFront] = useState("");
  const [editingBack, setEditingBack] = useState("");
  const [editingTopicIds, setEditingTopicIds] = useState<string[]>([]);
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [bulkTopicIds, setBulkTopicIds] = useState<string[]>([]);
  const [applyingBulkTopics, setApplyingBulkTopics] = useState(false);
  const [bulkMoveDeckId, setBulkMoveDeckId] = useState("");
  const [applyingBulkAction, setApplyingBulkAction] = useState<"move" | "delete" | null>(null);
  const [cardPendingDeleteId, setCardPendingDeleteId] = useState<string | null>(
    null
  );
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    const applyUrlState = () => {
      const state = getCardBrowserStateFromSearch(window.location.search);
      setSearchTerm(state.search);
      setDeckFilter(state.deckId);
      setFolderFilter(state.folderId);
      setTopicFilter(state.topicId);
      setLegacyTagFilter(state.legacyTag);
      setStatusFilter(state.status);
      setUrlStateReady(true);
    };

    applyUrlState();
    window.addEventListener("popstate", applyUrlState);
    return () => window.removeEventListener("popstate", applyUrlState);
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;

    const nextSearch = buildCardBrowserSearch(window.location.search, {
      search: searchTerm,
      deckId: deckFilter,
      folderId: folderFilter,
      topicId: topicFilter,
      legacyTag: legacyTagFilter,
      status: statusFilter,
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [
    deckFilter,
    folderFilter,
    legacyTagFilter,
    searchTerm,
    statusFilter,
    topicFilter,
    urlStateReady,
  ]);

  useEffect(() => {
    setVisibleResultLimit(CARD_RESULT_PAGE_SIZE);
  }, [cards.length, debouncedTerm, deckFilter, folderFilter, statusFilter, topicFilter]);

  useEffect(() => {
    setVisibleBrowseLimit(CARD_RESULT_PAGE_SIZE);
  }, [cards.length]);

  useEffect(() => {
    if (!previewCardId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewCardId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewCardId]);

  // Load all user cards + decks
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const [userDecks, cardsSnapshot, userSources, userFolders, userTopics] = await Promise.all([
          getDecks(user.uid),
          getDocs(
            query(
              collection(db, "cards"),
              where("userId", "==", user.uid)
            )
          ),
          getActiveSources(user.uid),
          getActiveStudyFolders(user.uid).catch(() => [] as StudyFolder[]),
          getActiveTopics(user.uid),
        ]);

        if (cancelled) return;

        const allCards = sortByCreatedAtNewest(
          cardsSnapshot.docs.map((cardDoc) =>
            mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>)
          ),
          (card) => card.createdAt
        );

        setDecks(userDecks);
        setCards(allCards);
        setSources(userSources);
        setFolders(userFolders);
        setTopics(userTopics);
      } catch (error) {
        console.error(error);
        if (!isPermissionDenied(error)) {
          setFeedback({ type: "error", message: "Failed to load cards." });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  useEffect(() => {
    if (!legacyTagFilter || topics.length === 0) return;
    const match = topics.find(
      (topic) => getTopicNameKey(topic.name) === getTopicNameKey(legacyTagFilter)
    );
    if (match) setTopicFilter(match.id);
    setLegacyTagFilter("");
  }, [legacyTagFilter, topics]);

  const deckNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const deck of decks) {
      map[deck.id] = deck.name;
    }
    return map;
  }, [decks]);
  const sourceNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const source of sources) {
      map[source.id] = source.title;
    }
    return map;
  }, [sources]);
  const folderNamesById = useMemo(
    () => Object.fromEntries(folders.map((folder) => [folder.id, folder.name])),
    [folders]
  );
  const topicNamesById = useMemo(
    () => Object.fromEntries(topics.map((topic) => [topic.id, topic.name])),
    [topics]
  );
  const deckFolderIdsById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.folderIds])),
    [decks]
  );

  const activeFilterCount =
    Number(Boolean(deckFilter)) +
    Number(Boolean(folderFilter)) +
    Number(Boolean(topicFilter)) +
    Number(statusFilter !== "all");
  const showFilterControls = showFilters;
  const hasSearchQuery = debouncedTerm.trim().length > 0;
  const shouldShowCardResults = shouldShowCardBrowserResults(
    debouncedTerm,
    activeFilterCount > 0,
  );
  const recentCards = useMemo(
    () => sortByCreatedAtNewest(cards, (card) => card.createdAt),
    [cards]
  );

  const filtered = useMemo(() => {
    if (!shouldShowCardResults) return [];

    const now = Date.now();
    return cards.filter((card) => {
      if (hasSearchQuery && !frontMatchesCardSearch(card.front, debouncedTerm)) return false;
      if (deckFilter && card.deckId !== deckFilter) return false;
      if (
        folderFilter &&
        !(deckFolderIdsById[card.deckId] ?? []).includes(folderFilter)
      ) {
        return false;
      }
      if (topicFilter && !card.topicIds?.includes(topicFilter)) {
        return false;
      }
      if (statusFilter === "due" && !(typeof card.dueDate !== "number" || card.dueDate <= now)) {
        return false;
      }
      if (statusFilter === "new" && (card.reps ?? card.repetitions ?? 0) > 0) {
        return false;
      }
      if (statusFilter === "weak" && getMemoryRiskInfo(card, now).tier !== "high") {
        return false;
      }
      return true;
    });
  }, [
    cards,
    debouncedTerm,
    deckFilter,
    deckFolderIdsById,
    folderFilter,
    hasSearchQuery,
    shouldShowCardResults,
    statusFilter,
    topicFilter,
  ]);

  const browseLimit = showAllCards ? visibleBrowseLimit : RECENT_CARD_COUNT;
  const displayedCardPool = shouldShowCardResults ? filtered : recentCards;
  const visibleCards = displayedCardPool.slice(
    0,
    shouldShowCardResults ? visibleResultLimit : browseLimit
  );
  const visibleCardIds = useMemo(() => visibleCards.map((card) => card.id), [visibleCards]);
  const remainingHiddenCards = Math.max(
    displayedCardPool.length - visibleCards.length,
    0
  );
  const hasMore =
    remainingHiddenCards > 0 && (shouldShowCardResults || showAllCards);
  const {
    selectedCardIdSet,
    selectVisibleCards,
    clearSelection,
    handleCheckboxClick,
  } = useCardSelection({
    visibleCardIds,
    selectedCardIds,
    setSelectedCardIds,
    disabled: isDemoUser,
  });
  const duplicateCounts = useMemo(() => getCardContentDuplicateCounts(cards), [cards]);
  const selectedCards = useMemo(() => {
    const selected = new Set(selectedCardIds);
    return cards.filter((card) => selected.has(card.id));
  }, [cards, selectedCardIds]);
  const bulkTopicCapacity = useMemo(
    () => getBulkTopicCapacity(selectedCards),
    [selectedCards]
  );
  const previewCard = cards.find((card) => card.id === previewCardId) ?? null;
  const clearAllFilters = () => {
    setSearchTerm("");
    setDebouncedTerm("");
    setDeckFilter("");
    setFolderFilter("");
    setTopicFilter("");
    setLegacyTagFilter("");
    setStatusFilter("all");
  };

  const startEditing = (card: Card) => {
    setExpandedCardId(card.id);
    setEditingFront(card.front);
    setEditingBack(card.back);
    setEditingTopicIds(card.topicIds ?? []);
    setFeedback(null);
  };

  const cancelEditing = () => {
    setExpandedCardId(null);
    setEditingFront("");
    setEditingBack("");
    setEditingTopicIds([]);
    setSavingCardId(null);
  };

  const handleSaveCard = async (cardId: string) => {
    if (isDemoUser) {
      setFeedback({ type: "error", message: "Card editing is disabled in the shared demo account." });
      return;
    }

    const nextFront = normalizeCardContentInput(editingFront);
    const nextBack = normalizeCardContentInput(editingBack);

    if (!nextFront || !nextBack) {
      setFeedback({ type: "error", message: "Both front and back are required." });
      return;
    }

    if (nextFront.length > MAX_FRONT_LENGTH || nextBack.length > MAX_BACK_LENGTH) {
      setFeedback({
        type: "error",
        message: `Cards must stay under ${MAX_FRONT_LENGTH} characters on the front and ${MAX_BACK_LENGTH} on the back.`,
      });
      return;
    }

    setSavingCardId(cardId);
    setFeedback(null);

    try {
      await updateDoc(doc(db, "cards", cardId), {
        front: nextFront,
        back: nextBack,
        topicIds: editingTopicIds,
        tags: [],
      });

      setCards((prev) =>
        prev.map((card) =>
          card.id === cardId
            ? {
                ...card,
                front: nextFront,
                back: nextBack,
                topicIds: editingTopicIds,
                tags: [],
              }
            : card
        )
      );
      cancelEditing();
      setFeedback({ type: "success", message: "Card updated." });
    } catch (error) {
      console.error(error);
      setSavingCardId(null);
      setFeedback({ type: "error", message: "Failed to update card." });
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (isDemoUser) {
      setFeedback({ type: "error", message: "Card deletion is disabled in the shared demo account." });
      return;
    }

    setDeletingCardId(cardId);
    setFeedback(null);

    try {
      await deleteDoc(doc(db, "cards", cardId));
      setCards((prev) => prev.filter((card) => card.id !== cardId));
      setSelectedCardIds((prev) => prev.filter((selectedId) => selectedId !== cardId));
      if (expandedCardId === cardId) cancelEditing();
      setCardPendingDeleteId(null);
      setFeedback({ type: "success", message: "Card deleted." });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to delete card." });
    } finally {
      setDeletingCardId(null);
    }
  };

  const handleCardsCreated = (
    createdCards: Card[],
    meta: { selectCreated: boolean }
  ) => {
    if (createdCards.length === 0) {
      return;
    }

    setCards((prev) => {
      const existingIds = new Set(prev.map((card) => card.id));
      const freshCards = createdCards.filter((card) => !existingIds.has(card.id));
      return [...freshCards, ...prev];
    });

    if (meta.selectCreated) {
      setSelectedCardIds(createdCards.map((card) => card.id));
      setBulkTopicIds([]);
    }
  };

  const handleAddTopicsToSelectedCards = async () => {
    if (selectedCardIds.length === 0 || bulkTopicIds.length === 0) {
      setFeedback({ type: "error", message: "Select cards and choose at least one Topic first." });
      return;
    }

    const overLimitCard = selectedCards.find((card) => {
      const current = card.topicIds ?? [];
      const additions = bulkTopicIds.filter((topicId) => !current.includes(topicId));
      return current.length + additions.length > MAX_LINKED_TOPICS;
    });
    if (overLimitCard) {
      setFeedback({
        type: "error",
        message: "One or more selected cards already has five Topics. Reduce its Topics before adding more.",
      });
      return;
    }
    const cardsToUpdate = selectedCards.map((card) => ({
      id: card.id,
      topicIds: Array.from(new Set([...(card.topicIds ?? []), ...bulkTopicIds])),
    }));

    setApplyingBulkTopics(true);
    setFeedback(null);

    try {
      for (let start = 0; start < cardsToUpdate.length; start += 450) {
        const batch = writeBatch(db);
        const chunk = cardsToUpdate.slice(start, start + 450);
        for (const card of chunk) {
          batch.update(doc(db, "cards", card.id), {
            topicIds: card.topicIds,
            tags: [],
          });
        }
        await batch.commit();
      }

      const topicIdsByCardId = new Map(
        cardsToUpdate.map((card) => [card.id, card.topicIds])
      );
      setCards((prev) =>
        prev.map((card) =>
          topicIdsByCardId.has(card.id)
            ? {
                ...card,
                topicIds: topicIdsByCardId.get(card.id) ?? card.topicIds,
                tags: [],
              }
            : card
        )
      );
      setBulkTopicIds([]);
      setSelectedCardIds([]);
      setFeedback({
        type: "success",
        message: `Added Topics to ${cardsToUpdate.length} card${cardsToUpdate.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to add Topics to the selected cards." });
    } finally {
      setApplyingBulkTopics(false);
    }
  };

  const handleMoveSelectedCards = async () => {
    if (!bulkMoveDeckId || selectedCardIds.length === 0) {
      setFeedback({ type: "error", message: "Select cards and choose a destination deck." });
      return;
    }
    setApplyingBulkAction("move");
    setFeedback(null);
    try {
      for (let start = 0; start < selectedCardIds.length; start += 450) {
        const batch = writeBatch(db);
        selectedCardIds.slice(start, start + 450).forEach((cardId) => {
          batch.update(doc(db, "cards", cardId), { deckId: bulkMoveDeckId });
        });
        await batch.commit();
      }
      const movedIds = new Set(selectedCardIds);
      setCards((current) =>
        current.map((card) =>
          movedIds.has(card.id) ? { ...card, deckId: bulkMoveDeckId } : card
        )
      );
      const movedCount = selectedCardIds.length;
      setSelectedCardIds([]);
      setBulkMoveDeckId("");
      setFeedback({
        type: "success",
        message: `Moved ${movedCount} card${movedCount === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to move the selected cards." });
    } finally {
      setApplyingBulkAction(null);
    }
  };

  const handleDeleteSelectedCards = async () => {
    if (selectedCardIds.length === 0) return;
    setApplyingBulkAction("delete");
    setFeedback(null);
    try {
      for (let start = 0; start < selectedCardIds.length; start += 450) {
        const batch = writeBatch(db);
        selectedCardIds.slice(start, start + 450).forEach((cardId) => {
          batch.delete(doc(db, "cards", cardId));
        });
        await batch.commit();
      }
      const deletedIds = new Set(selectedCardIds);
      const deletedCount = selectedCardIds.length;
      setCards((current) => current.filter((card) => !deletedIds.has(card.id)));
      setSelectedCardIds([]);
      setBulkDeletePending(false);
      setFeedback({
        type: "success",
        message: `Deleted ${deletedCount} card${deletedCount === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to delete the selected cards." });
    } finally {
      setApplyingBulkAction(null);
    }
  };

  return (
    <AppPage
      title="Cards"
      backHref="/dashboard"
      backLabel="Today"
      width="2xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      {feedback ? (
        <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />
      ) : null}
      <ConfirmDialog
        open={cardPendingDeleteId !== null}
        title="Delete this card?"
        description="This permanently removes the card from its deck and review queue. This cannot be undone."
        confirmLabel="Delete card"
        busy={
          cardPendingDeleteId !== null &&
          deletingCardId === cardPendingDeleteId
        }
        onClose={() => setCardPendingDeleteId(null)}
        onConfirm={() => {
          if (cardPendingDeleteId) void handleDeleteCard(cardPendingDeleteId);
        }}
      />
      <ConfirmDialog
        open={bulkDeletePending}
        title={`Delete ${selectedCardIds.length} selected card${
          selectedCardIds.length === 1 ? "" : "s"
        }?`}
        description="The selected cards will be permanently removed from their decks and review queues. This cannot be undone."
        confirmLabel="Delete selected"
        busy={applyingBulkAction === "delete"}
        onClose={() => setBulkDeletePending(false)}
        onConfirm={() => void handleDeleteSelectedCards()}
      />

      {!loading && !isDemoUser && (decks.length === 0 || cards.length === 0 || topics.length === 0) ? (
        <section className="grid gap-3 rounded-[1.5rem] border border-white/[0.08] bg-white/[0.035] p-4 sm:grid-cols-3">
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-white/[0.03] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">1. Decks</div>
            <div className="mt-2 text-sm font-medium text-white">
              {decks.length > 0 ? `${decks.length} ready` : "Create a deck"}
            </div>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              Decks group your cards by subject or exam.
            </p>
            {decks.length === 0 ? (
              <Link href="/dashboard/decks" className="mt-3 inline-flex text-xs font-semibold text-accent hover:text-white">
                Open decks
              </Link>
            ) : null}
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-white/[0.03] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">2. Cards</div>
            <div className="mt-2 text-sm font-medium text-white">
              {cards.length > 0 ? `${cards.length} ready` : "Add your first cards"}
            </div>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              Single card and paste-list import live just below.
            </p>
          </div>
          <div className="rounded-[1.1rem] border border-white/[0.08] bg-white/[0.03] p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">3. Topics</div>
            <div className="mt-2 text-sm font-medium text-white">
              {topics.length > 0 ? `${topics.length} ready` : "Add Topics when useful"}
            </div>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              Topics connect cards to the rest of your study material.
            </p>
          </div>
        </section>
      ) : null}

      {isDemoUser ? (
        <div className="rounded-[1.6rem] border border-white/[0.08] bg-white/[0.04] p-4 text-sm text-text-secondary">
          <div className="font-semibold text-white">Card editing is locked in the shared demo</div>
          <p className="mt-1 leading-6">
            You can search the seeded cards here, but new cards, edits, deletes, and Topic changes are reserved for private accounts.
          </p>
        </div>
      ) : (
        <CardCreationPanel
          userId={user.uid}
          decks={decks}
          existingCards={cards}
          topics={topics}
          onTopicsChange={setTopics}
          onCardsCreated={handleCardsCreated}
          onFeedback={setFeedback}
        />
      )}

      <div className="sticky top-0 z-20 -mx-1 space-y-3 rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-surface-base)]/95 p-3 shadow-[0_14px_30px_rgba(4,8,18,0.16)] backdrop-blur-xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-lg font-semibold text-text-primary">Browse cards</div>
            <p className="mt-0.5 text-sm text-text-muted">
              {shouldShowCardResults
                ? `${filtered.length} matching card${filtered.length === 1 ? "" : "s"}`
                : `${cards.length} card${cards.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            {!shouldShowCardResults && cards.length > RECENT_CARD_COUNT ? (
              <Button
                type="button"
                variant={showAllCards ? "secondary" : "ghost"}
                size="sm"
                aria-expanded={showAllCards}
                aria-controls="recent-cards-grid"
                onClick={() => setShowAllCards((current) => !current)}
                className="w-full sm:w-auto"
              >
                {showAllCards ? "Show less" : "View more"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={showFilterControls ? "secondary" : "ghost"}
              size="sm"
              aria-expanded={showFilterControls}
              onClick={() => setShowFilters((value) => !value)}
              className="w-full sm:w-auto"
            >
              {showFilterControls ? "Hide filters" : `Filters${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Search card fronts"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            containerClassName="min-w-0 flex-1"
          />
          {searchTerm ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setSearchTerm("")}>
              Clear search
            </Button>
          ) : null}
        </div>
        {showFilterControls ? (
          <div className="grid gap-3 rounded-[1.15rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-text-muted">Deck</span>
              <select
                aria-label="Filter cards by deck"
                value={deckFilter}
                onChange={(event) => setDeckFilter(event.target.value)}
                className="app-field min-h-10 w-full rounded-full px-3 text-sm"
              >
                <option value="">All decks</option>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>{deck.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-text-muted">Folder</span>
              <select
                aria-label="Filter cards by folder"
                value={folderFilter}
                onChange={(event) => setFolderFilter(event.target.value)}
                className="app-field min-h-10 w-full rounded-full px-3 text-sm"
              >
                <option value="">All folders</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-text-muted">Topic</span>
              <select
                aria-label="Filter cards by Topic"
                value={topicFilter}
                onChange={(event) => setTopicFilter(event.target.value)}
                className="app-field min-h-10 w-full rounded-full px-3 text-sm"
              >
                <option value="">All Topics</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>{topic.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-text-muted">Status</span>
              <select
                aria-label="Filter cards by study status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as CardStatusFilter)}
                className="app-field min-h-10 w-full rounded-full px-3 text-sm"
              >
                <option value="all">All statuses</option>
                <option value="due">Due</option>
                <option value="weak">Weak</option>
                <option value="new">New</option>
              </select>
            </label>
          </div>
        ) : null}
        {activeFilterCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {deckFilter ? (
              <button type="button" onClick={() => setDeckFilter("")} className="app-selected rounded-full px-3 py-1.5 text-xs font-medium">
                {deckNamesById[deckFilter] ?? "Deck"} ×
              </button>
            ) : null}
            {folderFilter ? (
              <button type="button" onClick={() => setFolderFilter("")} className="app-selected rounded-full px-3 py-1.5 text-xs font-medium">
                {folderNamesById[folderFilter] ?? "Folder"} ×
              </button>
            ) : null}
            {topicFilter ? (
              <button type="button" onClick={() => setTopicFilter("")} className="app-selected rounded-full px-3 py-1.5 text-xs font-medium">
                {topicNamesById[topicFilter] ?? "Topic"} ×
              </button>
            ) : null}
            {statusFilter !== "all" ? (
              <button type="button" onClick={() => setStatusFilter("all")} className="app-selected rounded-full px-3 py-1.5 text-xs font-medium capitalize">
                {statusFilter} ×
              </button>
            ) : null}
            <Button type="button" size="sm" variant="ghost" onClick={clearAllFilters}>
              Clear all filters
            </Button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          emoji="Cards"
          eyebrow="No cards yet"
          title="No cards yet"
          description="Create a card to start review."
          helperText={decks.length === 0 ? "Create a deck first." : undefined}
          action={decks.length === 0 ? <Link href="/dashboard/decks" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast hover:bg-accent-hover">Create a deck</Link> : undefined}
        />
      ) : shouldShowCardResults && filtered.length === 0 ? (
        <EmptyState
          emoji="Search"
          eyebrow="No match"
          title="No cards match"
          description={
            debouncedTerm
              ? `No cards match "${debouncedTerm}".`
              : "No cards match the selected filters."
          }
          action={<Button type="button" variant="secondary" onClick={clearAllFilters}>Clear all filters</Button>}
          secondaryAction={<a href="#add-card" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-[var(--button-primary-border)] bg-[var(--button-primary-bg)] px-4 text-sm font-medium text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)]">Add a card</a>}
        />
      ) : (
        <>
          {!isDemoUser ? (
            <>
              <BulkTopicToolbar
                userId={user.uid}
                selectedCount={selectedCardIds.length}
                visibleCount={visibleCards.length}
                topicIds={bulkTopicIds}
                topics={topics}
                maxTopicsToAdd={bulkTopicCapacity}
                disabled={applyingBulkTopics}
                onSelectAll={selectVisibleCards}
                onTopicIdsChange={setBulkTopicIds}
                onTopicsChange={setTopics}
                onApply={() => void handleAddTopicsToSelectedCards()}
                onClearSelection={clearSelection}
              />
              {selectedCardIds.length > 0 ? (
                <div className="grid gap-3 rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                      Move selected cards
                    </span>
                    <select
                      value={bulkMoveDeckId}
                      onChange={(event) => setBulkMoveDeckId(event.target.value)}
                      disabled={applyingBulkAction !== null}
                      className="app-field min-h-10 w-full rounded-full px-3 text-sm"
                    >
                      <option value="">Choose destination deck</option>
                      {decks.map((deck) => (
                        <option key={deck.id} value={deck.id}>{deck.name}</option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!bulkMoveDeckId || applyingBulkAction !== null}
                    onClick={() => void handleMoveSelectedCards()}
                  >
                    {applyingBulkAction === "move" ? "Moving..." : "Move"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={applyingBulkAction !== null}
                    onClick={() => setBulkDeletePending(true)}
                  >
                    {applyingBulkAction === "delete" ? "Deleting..." : "Delete selected"}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}

          <div
            id={!shouldShowCardResults ? "recent-cards-grid" : undefined}
            className="grid auto-rows-fr animate-slide-up touch-pan-y gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {visibleCards.map((card) => (
              <section
                key={card.id}
                className={`app-panel min-w-0 overflow-visible p-3 transition duration-fast ease-spring has-[details[open]]:z-40 hover:-translate-y-0.5 hover:shadow-shell ${
                  expandedCardId === card.id
                    ? "sm:col-span-2"
                    : "min-h-[8.5rem]"
                } ${
                  selectedCardIdSet.has(card.id)
                    ? "border-accent/45 ring-2 ring-accent/20"
                    : ""
                }`}
              >
                {expandedCardId === card.id ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <CardDifficultyBadge card={card} compact />
                      {!isDemoUser ? (
                        <label className="flex h-10 w-10 cursor-pointer items-center justify-center" title="Select card">
                          <span className="sr-only">Select card</span>
                          <input
                            type="checkbox"
                            aria-label={`Select card: ${card.front}`}
                            checked={selectedCardIdSet.has(card.id)}
                            onClick={(event) => handleCheckboxClick(card.id, event)}
                            onChange={() => undefined}
                            className="h-[1.1rem] w-[1.1rem] accent-[var(--color-accent)]"
                          />
                        </label>
                      ) : null}
                    </div>
                    <CardQualityWarnings
                      warnings={getCardQualityWarnings(
                        { front: editingFront, back: editingBack, topicIds: editingTopicIds },
                        { duplicateCount: duplicateCounts.get(getCardContentKey(card.front, card.back)) }
                      )}
                    />
                    <Input
                      label="Front"
                      value={editingFront}
                      onChange={(e) => setEditingFront(e.target.value)}
                      maxLength={MAX_FRONT_LENGTH}
                    />
                    <CardBackEditor
                      label="Back"
                      value={editingBack}
                      onChange={setEditingBack}
                      maxLength={MAX_BACK_LENGTH}
                      rows={6}
                      disabled={savingCardId === card.id}
                    />
                    {featureFlags.enableFlashcardAi ? (
                      <CardBackAutocomplete
                        front={editingFront}
                        currentBack={editingBack}
                        deckId={card.deckId}
                        deckName={deckNamesById[card.deckId]}
                        topics={editingTopicIds
                          .map((topicId) => topicNamesById[topicId])
                          .filter((name): name is string => Boolean(name))}
                        topicIds={editingTopicIds}
                        disabled={savingCardId === card.id}
                        onApply={setEditingBack}
                      />
                    ) : null}
                    <TopicPicker
                      userId={user.uid}
                      topics={topics}
                      selectedTopicIds={editingTopicIds}
                      onChange={setEditingTopicIds}
                      onTopicsChange={setTopics}
                      disabled={savingCardId === card.id}
                    />
                    <div className="grid gap-2 sm:flex sm:flex-wrap">
                      <Button
                        type="button"
                        disabled={savingCardId === card.id}
                        onClick={() => void handleSaveCard(card.id)}
                        className="w-full sm:w-auto"
                      >
                        {savingCardId === card.id ? "Saving..." : "Save card"}
                      </Button>
                      <Button
                        type="button"
                        disabled={savingCardId === card.id}
                        onClick={cancelEditing}
                        variant="secondary"
                        className="w-full sm:w-auto"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-w-0 flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <CardFaceSummary
                          front={card.front}
                          back={card.back}
                          onPreview={() => setPreviewCardId(card.id)}
                        />
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {!isDemoUser ? (
                          <label className="flex h-10 w-8 cursor-pointer items-center justify-center" title="Select card">
                            <span className="sr-only">Select card</span>
                            <input
                              type="checkbox"
                              aria-label={`Select card: ${card.front}`}
                              checked={selectedCardIdSet.has(card.id)}
                              onClick={(event) => handleCheckboxClick(card.id, event)}
                              onChange={() => undefined}
                              className="h-[1.1rem] w-[1.1rem] accent-[var(--color-accent)]"
                            />
                          </label>
                        ) : null}
                        <CardActionsMenu
                          deleting={deletingCardId === card.id}
                          disabled={isDemoUser || deletingCardId === card.id}
                          onEdit={() => startEditing(card)}
                          onDelete={() => setCardPendingDeleteId(card.id)}
                        />
                      </div>
                    </div>

                    {deckNamesById[card.deckId] ? (
                      <div className="mt-auto flex flex-wrap items-center gap-1.5">
                        <Link
                          href={getDeckHref(card.deckId)}
                          aria-label={`Open deck ${deckNamesById[card.deckId]}`}
                          className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-2.5 py-1 text-[0.68rem] font-medium text-text-secondary transition duration-fast hover:border-border-strong hover:bg-[var(--color-glass-medium)] hover:text-text-primary"
                        >
                          <span className="min-w-0 truncate">{deckNamesById[card.deckId]}</span>
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
                            <path d="M3.5 8h9" />
                            <path d="m8.5 3 4.5 5-4.5 5" />
                          </svg>
                        </Link>
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            ))}
          </div>
          {hasMore ? (
            <div className="flex justify-center pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (shouldShowCardResults) {
                    setVisibleResultLimit((limit) => limit + CARD_RESULT_PAGE_SIZE);
                  } else {
                    setVisibleBrowseLimit((limit) => limit + CARD_RESULT_PAGE_SIZE);
                  }
                }}
                className="w-full sm:w-auto"
              >
                Show {Math.min(CARD_RESULT_PAGE_SIZE, remainingHiddenCards)} more
              </Button>
            </div>
          ) : null}
        </>
      )}
      {previewCard ? (
        <div
          role="presentation"
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewCardId(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Card preview"
            className="w-full max-w-2xl rounded-[1.6rem] border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-5 shadow-[0_28px_80px_rgba(0,0,0,0.45)] sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  Card preview
                </div>
                <div className="mt-2 text-sm text-text-secondary">
                  {deckNamesById[previewCard.deckId] ?? "Deck"}
                </div>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewCardId(null)}>
                Close
              </Button>
            </div>
            <div className="mt-6 grid gap-4">
              <div className="rounded-[1.2rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.15em] text-text-muted">Front</div>
                <StudyText as="div" text={previewCard.front} className="mt-3 whitespace-pre-wrap text-lg font-medium leading-8 text-text-primary" />
              </div>
              <div className="rounded-[1.2rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.15em] text-text-muted">Back</div>
                <StudyText as="div" text={previewCard.back} className="mt-3 whitespace-pre-wrap text-base leading-7 text-text-secondary" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <CardDifficultyBadge card={previewCard} />
              <CardQualityWarnings
                warnings={getCardQualityWarnings(previewCard, {
                  duplicateCount: duplicateCounts.get(
                    getCardContentKey(previewCard.front, previewCard.back)
                  ),
                })}
              />
              {previewCard.sourceIds?.map((sourceId) => {
                const sourceName = sourceNamesById[sourceId];
                if (!sourceName) return null;
                return (
                  <span
                    key={sourceId}
                    className="max-w-full rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-medium text-warm-accent"
                  >
                    <span className="block truncate">Based on: {sourceName}</span>
                  </span>
                );
              })}
              {(previewCard.topicIds ?? []).map((topicId) => (
                <span
                  key={topicId}
                  className="max-w-full rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"
                >
                  <span className="block truncate">
                    {topicNamesById[topicId] ?? "Topic"}
                  </span>
                </span>
              ))}
            </div>
            {!isDemoUser ? (
              <div className="mt-5 flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setPreviewCardId(null);
                    startEditing(previewCard);
                  }}
                >
                  Edit card
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </AppPage>
  );
}
