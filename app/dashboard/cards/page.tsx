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
  addCardTag,
  getCardContentKey,
  getTagKey,
  mapCardData,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardContentInput,
  normalizeCardTags,
  type Card,
} from "@/lib/study/cards";
import type { Source } from "@/lib/practice/sources";
import { getCardContentDuplicateCounts, getCardQualityWarnings } from "@/lib/study/card-quality";
import { getDeckHref } from "@/lib/app/routes";
import { featureFlags } from "@/lib/app/feature-flags";
import { removeUserTag, renameUserTag } from "@/services/study/tags";
import AppPage from "@/components/layout/AppPage";
import TagInput from "@/components/decks/TagInput";
import CardCreationPanel from "@/components/decks/CardCreationPanel";
import BulkTagToolbar from "@/components/decks/BulkTagToolbar";
import CardQualityWarnings from "@/components/decks/CardQualityWarnings";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import CardDifficultyBadge from "@/components/study/CardDifficultyBadge";
import { useCardSelection } from "@/components/decks/useCardSelection";
import { Button, ConfirmDialog, EmptyState, FeedbackBanner, Input, Skeleton, StudyText } from "@/components/ui";
import Link from "next/link";

const CARD_RESULT_PAGE_SIZE = 50;
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
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [visibleResultLimit, setVisibleResultLimit] = useState(CARD_RESULT_PAGE_SIZE);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [deckFilter, setDeckFilter] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<CardStatusFilter>("all");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [editingFront, setEditingFront] = useState("");
  const [editingBack, setEditingBack] = useState("");
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [editingPendingTag, setEditingPendingTag] = useState("");
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [bulkPendingTag, setBulkPendingTag] = useState("");
  const [applyingBulkTags, setApplyingBulkTags] = useState(false);
  const [bulkMoveDeckId, setBulkMoveDeckId] = useState("");
  const [applyingBulkAction, setApplyingBulkAction] = useState<"move" | "delete" | null>(null);
  const [cardPendingDeleteId, setCardPendingDeleteId] = useState<string | null>(
    null
  );
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const [tagManagerSource, setTagManagerSource] = useState("");
  const [tagManagerTarget, setTagManagerTarget] = useState("");
  const [tagManagerAction, setTagManagerAction] = useState<"rename" | "remove" | null>(null);
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
      setTagFilter(state.tag);
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
      tag: tagFilter,
      status: statusFilter,
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [
    deckFilter,
    folderFilter,
    searchTerm,
    statusFilter,
    tagFilter,
    urlStateReady,
  ]);

  useEffect(() => {
    setVisibleResultLimit(CARD_RESULT_PAGE_SIZE);
  }, [cards.length, debouncedTerm, deckFilter, folderFilter, statusFilter, tagFilter]);

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
        const [userDecks, cardsSnapshot, userSources, userFolders] = await Promise.all([
          getDecks(user.uid),
          getDocs(
            query(
              collection(db, "cards"),
              where("userId", "==", user.uid)
            )
          ),
          getActiveSources(user.uid),
          getActiveStudyFolders(user.uid).catch(() => [] as StudyFolder[]),
        ]);

        if (cancelled) return;

        const allCards = cardsSnapshot.docs
          .map((cardDoc) =>
            mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>)
          )
          .sort((a, b) => b.createdAt - a.createdAt);

        const tags = Array.from(
          new Set(allCards.flatMap((c) => normalizeCardTags(c.tags)))
        ).sort((a, b) => a.localeCompare(b));

        setDecks(userDecks);
        setCards(allCards);
        setSources(userSources);
        setFolders(userFolders);
        setAvailableTags(tags);
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
  const deckFolderIdsById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.folderIds])),
    [decks]
  );

  const activeFilterCount =
    Number(Boolean(deckFilter)) +
    Number(Boolean(folderFilter)) +
    Number(Boolean(tagFilter)) +
    Number(statusFilter !== "all");
  const hasSearchQuery = debouncedTerm.trim().length > 0;
  const shouldShowCardResults = shouldShowCardBrowserResults(
    debouncedTerm,
    activeFilterCount > 0,
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
      if (tagFilter && !card.tags.some((tag) => getTagKey(tag) === getTagKey(tagFilter))) {
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
    tagFilter,
  ]);

  useEffect(() => {
    if (shouldShowCardResults) return;

    setSelectedCardIds([]);
    setBulkMoveDeckId("");
  }, [shouldShowCardResults]);

  const visibleCards = filtered.slice(0, visibleResultLimit);
  const visibleCardIds = useMemo(() => visibleCards.map((card) => card.id), [visibleCards]);
  const remainingHiddenCards = Math.max(filtered.length - visibleCards.length, 0);
  const hasMore = remainingHiddenCards > 0;
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
  const tagCounts = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const card of cards) {
      for (const tag of card.tags) {
        const key = getTagKey(tag);
        const current = counts.get(key) ?? { label: tag, count: 0 };
        current.count += 1;
        counts.set(key, current);
      }
    }
    return counts;
  }, [cards]);
  const previewCard = cards.find((card) => card.id === previewCardId) ?? null;
  const clearAllFilters = () => {
    setSearchTerm("");
    setDebouncedTerm("");
    setDeckFilter("");
    setFolderFilter("");
    setTagFilter("");
    setStatusFilter("all");
  };

  const startEditing = (card: Card) => {
    setExpandedCardId(card.id);
    setEditingFront(card.front);
    setEditingBack(card.back);
    setEditingTags(card.tags);
    setEditingPendingTag("");
    setFeedback(null);
  };

  const cancelEditing = () => {
    setExpandedCardId(null);
    setEditingFront("");
    setEditingBack("");
    setEditingTags([]);
    setEditingPendingTag("");
    setSavingCardId(null);
  };

  const handleSaveCard = async (cardId: string) => {
    if (isDemoUser) {
      setFeedback({ type: "error", message: "Card editing is disabled in the shared demo account." });
      return;
    }

    const nextFront = normalizeCardContentInput(editingFront);
    const nextBack = normalizeCardContentInput(editingBack);
    const tagResult = addCardTag(editingTags, editingPendingTag);

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

    if (tagResult.error) {
      setFeedback({ type: "error", message: tagResult.error });
      return;
    }

    const nextTags = tagResult.nextTags;
    setSavingCardId(cardId);
    setFeedback(null);

    try {
      await updateDoc(doc(db, "cards", cardId), {
        front: nextFront,
        back: nextBack,
        tags: nextTags,
      });

      setCards((prev) =>
        prev.map((card) =>
          card.id === cardId
            ? { ...card, front: nextFront, back: nextBack, tags: nextTags }
            : card
        )
      );
      setAvailableTags((prev) =>
        Array.from(new Set([...prev, ...nextTags])).sort((a, b) =>
          a.localeCompare(b)
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
    setAvailableTags((prev) =>
      Array.from(new Set([...prev, ...createdCards.flatMap((card) => card.tags)])).sort((a, b) =>
        a.localeCompare(b)
      )
    );

    if (meta.selectCreated) {
      setSelectedCardIds(createdCards.map((card) => card.id));
      setBulkTags([]);
      setBulkPendingTag("");
    }
  };

  const handleAddTagsToSelectedCards = async () => {
    const tagResult = addCardTag(bulkTags, bulkPendingTag);
    if (tagResult.error) {
      setFeedback({ type: "error", message: tagResult.error });
      return;
    }

    const nextBulkTags = tagResult.nextTags;
    if (selectedCardIds.length === 0 || nextBulkTags.length === 0) {
      setFeedback({ type: "error", message: "Select cards and add at least one tag first." });
      return;
    }

    const selected = new Set(selectedCardIds);
    const cardsToUpdate = cards
      .filter((card) => selected.has(card.id))
      .map((card) => ({
        id: card.id,
        tags: normalizeCardTags([...card.tags, ...nextBulkTags]),
      }));

    setApplyingBulkTags(true);
    setFeedback(null);

    try {
      for (let start = 0; start < cardsToUpdate.length; start += 450) {
        const batch = writeBatch(db);
        const chunk = cardsToUpdate.slice(start, start + 450);
        for (const card of chunk) {
          batch.update(doc(db, "cards", card.id), { tags: card.tags });
        }
        await batch.commit();
      }

      const tagsByCardId = new Map(cardsToUpdate.map((card) => [card.id, card.tags]));
      setCards((prev) =>
        prev.map((card) =>
          tagsByCardId.has(card.id)
            ? { ...card, tags: tagsByCardId.get(card.id) ?? card.tags }
            : card
        )
      );
      setAvailableTags((prev) =>
        Array.from(new Set([...prev, ...nextBulkTags])).sort((a, b) => a.localeCompare(b))
      );
      setBulkTags([]);
      setBulkPendingTag("");
      setSelectedCardIds([]);
      setFeedback({
        type: "success",
        message: `Added tags to ${cardsToUpdate.length} card${cardsToUpdate.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to add tags to the selected cards." });
    } finally {
      setApplyingBulkTags(false);
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

  const refreshAvailableTagsFromCards = (nextCards: Card[]) => {
    setAvailableTags(
      Array.from(new Set(nextCards.flatMap((card) => normalizeCardTags(card.tags)))).sort((a, b) =>
        a.localeCompare(b)
      )
    );
  };

  const applyLocalTagRename = (sourceTag: string, targetTag: string) => {
    const sourceKey = getTagKey(sourceTag);
    const nextCards = cards.map((card) => ({
      ...card,
      tags: normalizeCardTags(
        card.tags.map((tag) => (getTagKey(tag) === sourceKey ? targetTag : tag))
      ),
    }));
    setCards(nextCards);
    refreshAvailableTagsFromCards(nextCards);
  };

  const applyLocalTagRemoval = (sourceTag: string) => {
    const sourceKey = getTagKey(sourceTag);
    const nextCards = cards.map((card) => ({
      ...card,
      tags: normalizeCardTags(card.tags.filter((tag) => getTagKey(tag) !== sourceKey)),
    }));
    setCards(nextCards);
    refreshAvailableTagsFromCards(nextCards);
  };

  const handleRenameTag = async () => {
    if (isDemoUser) {
      setFeedback({ type: "error", message: "Tag editing is disabled in the shared demo account." });
      return;
    }

    const sourceTag = tagManagerSource.trim();
    const targetTag = tagManagerTarget.trim();
    if (!sourceTag || !targetTag) {
      setFeedback({ type: "error", message: "Choose a tag and enter the new tag name." });
      return;
    }

    setTagManagerAction("rename");
    setFeedback(null);
    try {
      const count = await renameUserTag(user.uid, sourceTag, targetTag);
      applyLocalTagRename(sourceTag, targetTag);
      setTagManagerSource(targetTag);
      setTagManagerTarget("");
      setFeedback({ type: "success", message: `Updated ${count} card${count === 1 ? "" : "s"}.` });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to rename that tag.",
      });
    } finally {
      setTagManagerAction(null);
    }
  };

  const handleRemoveTag = async () => {
    if (isDemoUser) {
      setFeedback({ type: "error", message: "Tag editing is disabled in the shared demo account." });
      return;
    }

    const sourceTag = tagManagerSource.trim();
    if (!sourceTag) {
      setFeedback({ type: "error", message: "Choose a tag to remove." });
      return;
    }

    const shouldRemove = window.confirm(`Remove "${sourceTag}" from every card?`);
    if (!shouldRemove) {
      return;
    }

    setTagManagerAction("remove");
    setFeedback(null);
    try {
      const count = await removeUserTag(user.uid, sourceTag);
      applyLocalTagRemoval(sourceTag);
      setTagManagerSource("");
      setTagManagerTarget("");
      setFeedback({ type: "success", message: `Removed tag from ${count} card${count === 1 ? "" : "s"}.` });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to remove that tag.",
      });
    } finally {
      setTagManagerAction(null);
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

      {!loading && !isDemoUser && (decks.length === 0 || cards.length === 0 || availableTags.length === 0) ? (
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
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">3. Tags</div>
            <div className="mt-2 text-sm font-medium text-white">
              {availableTags.length > 0 ? `${availableTags.length} ready` : "Add tags when useful"}
            </div>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              Tags unlock cleaner Focused Review sessions.
            </p>
          </div>
        </section>
      ) : null}

      {isDemoUser ? (
        <div className="rounded-[1.6rem] border border-white/[0.08] bg-white/[0.04] p-4 text-sm text-text-secondary">
          <div className="font-semibold text-white">Card editing is locked in the shared demo</div>
          <p className="mt-1 leading-6">
            You can search the seeded cards here, but new cards, edits, deletes, and tag changes are reserved for private accounts.
          </p>
        </div>
      ) : (
        <CardCreationPanel
          userId={user.uid}
          decks={decks}
          existingCards={cards}
          availableTags={availableTags}
          onCardsCreated={handleCardsCreated}
          onFeedback={setFeedback}
        />
      )}

      {!isDemoUser ? (
        <section className="app-panel p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-text-muted">
                Tag manager
              </div>
              <h2 className="mt-2 text-lg font-semibold tracking-tight text-white sm:text-xl">
                Rename, merge, or remove tags.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
                Pick a tag below, then rename it. Renaming to an existing tag will merge them across your cards.
              </p>
            </div>
            <div className="rounded-[1.2rem] border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-text-secondary">
              <span className="font-semibold text-white">{availableTags.length}</span> tag{availableTags.length === 1 ? "" : "s"}
            </div>
          </div>

          {availableTags.length === 0 ? (
            <div className="mt-4 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
              Add a tag to any card and it will appear here for cleanup later.
            </div>
          ) : (
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
              <div className="max-h-56 overflow-y-auto rounded-[1.25rem] border border-white/[0.08] bg-white/[0.025] p-2">
                <div className="flex flex-wrap gap-2">
                  {availableTags.map((tag) => {
                    const selected = getTagKey(tagManagerSource) === getTagKey(tag);
                    const count = tagCounts.get(getTagKey(tag))?.count ?? 0;
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          setTagManagerSource(tag);
                          setTagManagerTarget("");
                          setFeedback(null);
                        }}
                        className={`rounded-full border px-3 py-2 text-left text-sm transition duration-fast ${
                          selected
                            ? "border-accent bg-accent/20 text-accent"
                            : "border-border bg-white/[0.04] text-white hover:border-border-strong hover:bg-white/[0.07]"
                        }`}
                      >
                        {tag} · {count} card{count === 1 ? "" : "s"}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4">
                <Input
                  label="Selected tag"
                  value={tagManagerSource}
                  onChange={(event) => setTagManagerSource(event.target.value)}
                  placeholder="Choose or type a tag"
                  disabled={tagManagerAction !== null}
                />
                <Input
                  label="Rename or merge into"
                  value={tagManagerTarget}
                  onChange={(event) => setTagManagerTarget(event.target.value)}
                  placeholder="New or existing tag"
                  disabled={tagManagerAction !== null}
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    disabled={tagManagerAction !== null || !tagManagerSource.trim() || !tagManagerTarget.trim()}
                    onClick={() => void handleRenameTag()}
                    className="w-full sm:w-auto"
                  >
                    {tagManagerAction === "rename" ? "Updating..." : "Rename / merge"}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={tagManagerAction !== null || !tagManagerSource.trim()}
                    onClick={() => void handleRemoveTag()}
                    className="w-full sm:w-auto"
                  >
                    {tagManagerAction === "remove" ? "Removing..." : "Remove tag"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <div className="sticky top-0 z-20 -mx-1 space-y-3 rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-surface-base)]/95 p-3 shadow-[0_14px_30px_rgba(4,8,18,0.16)] backdrop-blur-xl">
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
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <select
            aria-label="Filter cards by deck"
            value={deckFilter}
            onChange={(event) => setDeckFilter(event.target.value)}
            className="app-field min-h-10 rounded-full px-3 text-sm"
          >
            <option value="">All decks</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>{deck.name}</option>
            ))}
          </select>
          <select
            aria-label="Filter cards by folder"
            value={folderFilter}
            onChange={(event) => setFolderFilter(event.target.value)}
            className="app-field min-h-10 rounded-full px-3 text-sm"
          >
            <option value="">All folders</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
          <select
            aria-label="Filter cards by tag"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            className="app-field min-h-10 rounded-full px-3 text-sm"
          >
            <option value="">All tags</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
          <select
            aria-label="Filter cards by study status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as CardStatusFilter)}
            className="app-field min-h-10 rounded-full px-3 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="due">Due</option>
            <option value="weak">Weak</option>
            <option value="new">New</option>
          </select>
        </div>
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
            {tagFilter ? (
              <button type="button" onClick={() => setTagFilter("")} className="app-selected rounded-full px-3 py-1.5 text-xs font-medium">
                {tagFilter} ×
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
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
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
      ) : !shouldShowCardResults ? (
        <EmptyState
          emoji="Search"
          eyebrow="Card browser"
          title="Search or filter your cards"
          description="Type the start of a card front, or choose a deck, folder, tag, or status filter."
          helperText="Add a space after a word to find that whole word anywhere in a card front."
        />
      ) : filtered.length === 0 ? (
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
              <BulkTagToolbar
                selectedCount={selectedCardIds.length}
                visibleCount={visibleCards.length}
                tags={bulkTags}
                pendingTag={bulkPendingTag}
                availableTags={availableTags}
                disabled={applyingBulkTags}
                onSelectAll={selectVisibleCards}
                onTagsChange={setBulkTags}
                onPendingTagChange={setBulkPendingTag}
                onApply={() => void handleAddTagsToSelectedCards()}
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

          <p className="text-sm text-text-secondary">
            Showing {visibleCards.length} of {filtered.length} card{filtered.length === 1 ? "" : "s"}.
            Use the deck pill on any card to jump into that deck.
          </p>

          <div
            className="grid animate-slide-up touch-pan-y gap-3 sm:gap-4 lg:grid-cols-2"
          >
            {visibleCards.map((card) => (
              <section
                key={card.id}
                className={`app-panel p-3 transition duration-fast ease-spring hover:-translate-y-0.5 hover:shadow-shell sm:p-4 ${
                  selectedCardIdSet.has(card.id)
                    ? "border-accent/45 ring-2 ring-accent/20"
                    : ""
                }`}
              >
                {!isDemoUser ? (
                  <div className="mb-3 flex items-center justify-end">
                    <label className="flex min-h-9 items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs font-medium text-text-secondary">
                      <input
                        type="checkbox"
                        checked={selectedCardIdSet.has(card.id)}
                        onClick={(event) => handleCheckboxClick(card.id, event)}
                        onChange={() => undefined}
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                      Select
                    </label>
                  </div>
                ) : null}
                {expandedCardId === card.id ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <CardDifficultyBadge card={card} />
                    </div>
                    <CardQualityWarnings
                      warnings={getCardQualityWarnings(
                        { front: editingFront, back: editingBack, tags: editingTags },
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
                        tags={editingTags}
                        disabled={savingCardId === card.id}
                        onApply={setEditingBack}
                      />
                    ) : null}
                    <TagInput
                      tags={editingTags}
                      pendingTag={editingPendingTag}
                      availableTags={availableTags}
                      onTagsChange={setEditingTags}
                      onPendingTagChange={setEditingPendingTag}
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
                  <div className="space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <button
                        type="button"
                        className="min-w-0 flex-1 space-y-1 text-left"
                        onClick={() => setPreviewCardId(card.id)}
                        aria-label={`Preview card: ${card.front}`}
                      >
                        <StudyText
                          as="div"
                          text={card.front}
                          className="line-clamp-3 whitespace-pre-wrap text-[0.9rem] font-medium leading-6 text-white sm:text-[0.95rem] sm:leading-7"
                        />
                        <StudyText
                          as="div"
                          text={card.back}
                          className="line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary"
                        />
                      </button>
                      <div className="grid grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                        <Button
                          type="button"
                          onClick={() => setPreviewCardId(card.id)}
                          variant="ghost"
                          className="w-full sm:w-auto"
                        >
                          Preview
                        </Button>
                        <Button
                          type="button"
                          disabled={isDemoUser || deletingCardId === card.id}
                          onClick={() => startEditing(card)}
                          variant="secondary"
                          className="w-full sm:w-auto"
                        >
                          Edit card
                        </Button>
                        <Button
                          type="button"
                          disabled={isDemoUser || deletingCardId === card.id}
                          onClick={() => setCardPendingDeleteId(card.id)}
                          variant="danger"
                          className="w-full sm:w-auto"
                        >
                          {deletingCardId === card.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <CardDifficultyBadge card={card} />
                      <CardQualityWarnings
                        warnings={getCardQualityWarnings(card, {
                          duplicateCount: duplicateCounts.get(getCardContentKey(card.front, card.back)),
                        })}
                      />
                      {deckNamesById[card.deckId] ? (
                        <Link
                          href={getDeckHref(card.deckId)}
                          aria-label={`Open deck ${deckNamesById[card.deckId]}`}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-text-secondary transition duration-fast hover:border-border-strong hover:bg-white/[0.08] hover:text-white"
                        >
                          <span className="min-w-0 truncate">{deckNamesById[card.deckId]}</span>
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                            <path d="M3.5 8h9" />
                            <path d="m8.5 3 4.5 5-4.5 5" />
                          </svg>
                        </Link>
                      ) : null}
                      {card.sourceIds?.map((sourceId) => {
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
                      {card.tags.map((tag) => (
                        <span
                          key={tag}
                          className="max-w-full rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"
                        >
                          <span className="block truncate">{tag}</span>
                        </span>
                      ))}
                    </div>
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
                onClick={() => setVisibleResultLimit((limit) => limit + CARD_RESULT_PAGE_SIZE)}
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
