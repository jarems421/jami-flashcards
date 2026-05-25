"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { FirebaseError } from "firebase/app";
import { collection, deleteDoc, doc, getDocs, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { db } from "@/services/firebase/client";
import { getDecks, type Deck } from "@/services/study/decks";
import { getActiveSources } from "@/services/study/sources";
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
import { Button, EmptyState, FeedbackBanner, Input, Skeleton, StudyText } from "@/components/ui";
import Link from "next/link";

function cardMatchesSearch(card: Card, term: string, deckName?: string) {
  if (!term) return true;
  const lower = term.toLowerCase();
  if (card.front.toLowerCase().includes(lower)) return true;
  if (card.back.toLowerCase().includes(lower)) return true;
  if (card.tags.some((tag) => tag.toLowerCase().includes(lower))) return true;
  if (deckName && deckName.toLowerCase().includes(lower)) return true;
  return false;
}

const CARD_RESULT_PAGE_SIZE = 50;
type SelectionDragMode = "select" | "deselect";

function isPermissionDenied(error: unknown) {
  return error instanceof FirebaseError && error.code === "permission-denied";
}

export default function CardsSearchPage() {
  const { user, isDemoUser } = useUser();

  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [visibleResultLimit, setVisibleResultLimit] = useState(CARD_RESULT_PAGE_SIZE);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [editingFront, setEditingFront] = useState("");
  const [editingBack, setEditingBack] = useState("");
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [editingPendingTag, setEditingPendingTag] = useState("");
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [selectionDragMode, setSelectionDragMode] = useState<SelectionDragMode | null>(null);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [bulkPendingTag, setBulkPendingTag] = useState("");
  const [applyingBulkTags, setApplyingBulkTags] = useState(false);
  const [tagManagerSource, setTagManagerSource] = useState("");
  const [tagManagerTarget, setTagManagerTarget] = useState("");
  const [tagManagerAction, setTagManagerAction] = useState<"rename" | "remove" | null>(null);
  const selectionDragModeRef = useRef<SelectionDragMode | null>(null);
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
    setVisibleResultLimit(CARD_RESULT_PAGE_SIZE);
  }, [cards.length, debouncedTerm]);

  // Load all user cards + decks
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const [userDecks, cardsSnapshot, userSources] = await Promise.all([
          getDecks(user.uid),
          getDocs(
            query(
              collection(db, "cards"),
              where("userId", "==", user.uid)
            )
          ),
          getActiveSources(user.uid),
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

  const filtered = useMemo(() => {
    if (!debouncedTerm) return cards;
    return cards.filter((card) =>
      cardMatchesSearch(card, debouncedTerm, deckNamesById[card.deckId])
    );
  }, [cards, debouncedTerm, deckNamesById]);

  const visibleCards = filtered.slice(0, visibleResultLimit);
  const remainingHiddenCards = Math.max(filtered.length - visibleCards.length, 0);
  const hasMore = remainingHiddenCards > 0;
  const selectedCardIdSet = useMemo(() => new Set(selectedCardIds), [selectedCardIds]);
  const visibleCardIdSet = useMemo(() => new Set(visibleCards.map((card) => card.id)), [visibleCards]);
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

  const setSelectionDrag = useCallback((mode: SelectionDragMode | null) => {
    selectionDragModeRef.current = mode;
    setSelectionDragMode(mode);
  }, []);

  const applyCardSelectionDrag = useCallback(
    (cardId: string, mode: SelectionDragMode) => {
      if (!visibleCardIdSet.has(cardId)) {
        return;
      }

      setSelectedCardIds((prev) => {
        const selected = prev.includes(cardId);
        if (mode === "select") {
          return selected ? prev : [...prev, cardId];
        }

        return selected ? prev.filter((selectedId) => selectedId !== cardId) : prev;
      });
    },
    [visibleCardIdSet]
  );

  useEffect(() => {
    const stopSelectionDrag = () => setSelectionDrag(null);
    window.addEventListener("pointerup", stopSelectionDrag);
    window.addEventListener("pointercancel", stopSelectionDrag);
    return () => {
      window.removeEventListener("pointerup", stopSelectionDrag);
      window.removeEventListener("pointercancel", stopSelectionDrag);
    };
  }, [setSelectionDrag]);

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

    const shouldDelete = window.confirm("Delete this card?");
    if (!shouldDelete) return;

    setDeletingCardId(cardId);
    setFeedback(null);

    try {
      await deleteDoc(doc(db, "cards", cardId));
      setCards((prev) => prev.filter((card) => card.id !== cardId));
      setSelectedCardIds((prev) => prev.filter((selectedId) => selectedId !== cardId));
      if (expandedCardId === cardId) cancelEditing();
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

  const toggleCardSelection = (cardId: string) => {
    setSelectedCardIds((prev) =>
      prev.includes(cardId)
        ? prev.filter((selectedId) => selectedId !== cardId)
        : [...prev, cardId]
    );
  };

  const handleCardPointerDown = (cardId: string, selected: boolean) => (event: PointerEvent<HTMLElement>) => {
    if (isDemoUser || event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();
    const mode: SelectionDragMode = selected ? "deselect" : "select";
    setSelectionDrag(mode);
    applyCardSelectionDrag(cardId, mode);
  };

  const handleCardPointerEnter = (cardId: string) => {
    const mode = selectionDragModeRef.current;
    if (mode) {
      applyCardSelectionDrag(cardId, mode);
    }
  };

  const handleCardPointerMove = (event: PointerEvent<HTMLElement>) => {
    const mode = selectionDragModeRef.current;
    if (!mode || typeof document === "undefined") {
      return;
    }

    const element = document.elementFromPoint(event.clientX, event.clientY);
    const cardElement = element instanceof HTMLElement ? element.closest<HTMLElement>("[data-card-id]") : null;
    const cardId = cardElement?.dataset.cardId;
    if (cardId) {
      applyCardSelectionDrag(cardId, mode);
    }
  };

  const selectVisibleCards = () => {
    setSelectedCardIds((prev) =>
      Array.from(new Set([...prev, ...visibleCards.map((card) => card.id)]))
    );
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
        <>
          <section className="rounded-[1.45rem] border border-white/[0.09] bg-white/[0.04] p-4 text-sm leading-6 text-text-secondary">
            <div className="font-semibold text-white">Cards are the individual flashcards inside your decks.</div>
            <p className="mt-1">
              This page lets you search and edit cards across every deck. To create your first card,
              choose a deck first, then write the front and back.
            </p>
          </section>
          <CardCreationPanel
            userId={user.uid}
            decks={decks}
            existingCards={cards}
            availableTags={availableTags}
            onCardsCreated={handleCardsCreated}
            onFeedback={setFeedback}
          />
        </>
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

      <div className="sticky top-0 z-20 -mx-1 px-1 pb-2 pt-1">
        <Input
          placeholder="Search cards, decks, or tags"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />
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
          description="Cards are what power Daily Review and Focused Review. Add a prompt and answer above to create your first one."
          helperText={decks.length === 0 ? "You will need a deck first, then cards can be added here." : "Once saved, new cards appear in study automatically."}
          action={decks.length === 0 ? <Link href="/dashboard/decks" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast hover:bg-accent-hover">Create a deck</Link> : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          emoji="Search"
          eyebrow="No match"
          title="No cards match"
          description={`No cards match "${debouncedTerm}". Try a shorter search, another deck name, or a tag you remember.`}
          action={<Button type="button" variant="secondary" onClick={() => setSearchTerm("")}>Clear search</Button>}
        />
      ) : (
        <>
          {!isDemoUser ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={selectVisibleCards}
                  disabled={visibleCards.length === 0}
                  className="w-full sm:w-auto"
                >
                  Select shown cards
                </Button>
                <span className="text-center text-sm text-text-muted sm:text-right">
                  {selectedCardIds.length} selected for bulk edit
                </span>
              </div>
              <div
                className={`rounded-[1.25rem] border px-4 py-3 text-sm leading-6 transition duration-fast ${
                  selectionDragMode
                    ? "border-accent/35 bg-accent/10 text-accent"
                    : "border-white/[0.08] bg-white/[0.025] text-text-muted"
                }`}
              >
                {selectionDragMode
                  ? selectionDragMode === "select"
                    ? "Selecting as you slide."
                    : "Deselecting as you slide."
                  : (
                    <>
                      <span className="sm:hidden">Tap Select on cards, or use the handle for quick multi-select.</span>
                      <span className="hidden sm:inline">Use the selection handle on a card, then slide across other handles or panels to select or deselect several at once.</span>
                    </>
                  )}
              </div>

              <BulkTagToolbar
                selectedCount={selectedCardIds.length}
                tags={bulkTags}
                pendingTag={bulkPendingTag}
                availableTags={availableTags}
                disabled={applyingBulkTags}
                onTagsChange={setBulkTags}
                onPendingTagChange={setBulkPendingTag}
                onApply={() => void handleAddTagsToSelectedCards()}
                onClearSelection={() => setSelectedCardIds([])}
              />
            </>
          ) : null}

          <p className="text-sm text-text-secondary">
            Showing {visibleCards.length} of {filtered.length} card{filtered.length === 1 ? "" : "s"}.
            Use the deck pill on any card to jump into that deck.
          </p>

          <div
            className="grid animate-slide-up touch-pan-y select-none gap-3 sm:gap-4 lg:grid-cols-2"
            onPointerMove={handleCardPointerMove}
          >
            {visibleCards.map((card) => (
              <section
                key={card.id}
                data-card-id={card.id}
                onPointerEnter={() => handleCardPointerEnter(card.id)}
                className={`app-panel p-3 sm:p-4 transition duration-fast ease-spring hover:-translate-y-0.5 hover:shadow-shell ${
                  selectedCardIdSet.has(card.id)
                    ? "border-accent/45 ring-2 ring-accent/20"
                    : ""
                }`}
              >
                {!isDemoUser ? (
                  <div className="mb-3 flex items-center justify-between gap-2 sm:justify-start">
                    <button
                      type="button"
                      onPointerDown={handleCardPointerDown(card.id, selectedCardIdSet.has(card.id))}
                      className="inline-flex h-9 w-9 touch-none cursor-grab items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.055] text-text-secondary transition duration-fast hover:border-accent/40 hover:bg-accent/10 hover:text-accent active:cursor-grabbing"
                      aria-label={`${selectedCardIdSet.has(card.id) ? "Deselect" : "Select"} this card and slide across more cards`}
                      title="Selection handle"
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" className="h-4 w-4">
                        <path d="M4 3.5h8" />
                        <path d="M4 8h8" />
                        <path d="M4 12.5h8" />
                      </svg>
                    </button>
                    <label className="flex min-h-9 flex-1 items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs font-medium text-text-secondary sm:flex-none">
                      <input
                        type="checkbox"
                        checked={selectedCardIdSet.has(card.id)}
                        onChange={() => toggleCardSelection(card.id)}
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
                      <div className="min-w-0 flex-1 space-y-1">
                        <StudyText
                          as="div"
                          text={card.front}
                          className="whitespace-pre-wrap text-[0.9rem] font-normal leading-6 text-white sm:text-[0.95rem] sm:leading-7"
                        />
                        <StudyText
                          as="div"
                          text={card.back}
                          className="whitespace-pre-wrap text-sm leading-6 text-text-secondary"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
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
                          onClick={() => void handleDeleteCard(card.id)}
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
    </AppPage>
  );
}
