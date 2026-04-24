"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { db } from "@/services/firebase/client";
import { getDecks, type Deck } from "@/services/study/decks";
import {
  addCardTag,
  mapCardData,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardContentInput,
  normalizeCardTags,
  type Card,
} from "@/lib/study/cards";
import { getDeckHref } from "@/lib/app/routes";
import AppPage from "@/components/layout/AppPage";
import TagInput from "@/components/decks/TagInput";
import CardCreationPanel from "@/components/decks/CardCreationPanel";
import BulkTagToolbar from "@/components/decks/BulkTagToolbar";
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

const MAX_VISIBLE_RESULTS = 50;

export default function CardsSearchPage() {
  const { user, isDemoUser } = useUser();

  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
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
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Load all user cards + decks
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const [userDecks, cardsSnapshot] = await Promise.all([
          getDecks(user.uid),
          getDocs(
            query(
              collection(db, "cards"),
              where("userId", "==", user.uid)
            )
          ),
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
        setAvailableTags(tags);
      } catch (error) {
        console.error(error);
        setFeedback({ type: "error", message: "Failed to load cards." });
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

  const filtered = useMemo(() => {
    if (!debouncedTerm) return cards;
    return cards.filter((card) =>
      cardMatchesSearch(card, debouncedTerm, deckNamesById[card.deckId])
    );
  }, [cards, debouncedTerm, deckNamesById]);

  const visibleCards = filtered.slice(0, MAX_VISIBLE_RESULTS);
  const hasMore = filtered.length > MAX_VISIBLE_RESULTS;
  const selectedCardIdSet = useMemo(() => new Set(selectedCardIds), [selectedCardIds]);

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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={selectVisibleCards}
                  disabled={visibleCards.length === 0}
                >
                  Select visible cards
                </Button>
                <span className="text-sm text-text-muted">
                  {selectedCardIds.length} selected for bulk edit
                </span>
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
            {filtered.length} card{filtered.length === 1 ? "" : "s"} found
            {hasMore ? ` (showing first ${MAX_VISIBLE_RESULTS})` : ""}. Use the deck pill on any card to jump into that deck.
          </p>

          <div className="grid animate-slide-up gap-3 sm:gap-4 lg:grid-cols-2">
            {visibleCards.map((card) => (
              <section key={card.id} className="app-panel p-3 sm:p-4 transition duration-fast ease-spring hover:-translate-y-0.5 hover:shadow-shell">
                {!isDemoUser ? (
                  <label className="mb-3 flex w-fit items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs font-medium text-text-secondary">
                    <input
                      type="checkbox"
                      checked={selectedCardIdSet.has(card.id)}
                      onChange={() => toggleCardSelection(card.id)}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    Select
                  </label>
                ) : null}
                {expandedCardId === card.id ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <CardDifficultyBadge card={card} />
                    </div>
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
                    <CardBackAutocomplete
                      front={editingFront}
                      currentBack={editingBack}
                      deckId={card.deckId}
                      deckName={deckNamesById[card.deckId]}
                      tags={editingTags}
                      disabled={savingCardId === card.id}
                      onApply={setEditingBack}
                    />
                    <TagInput
                      tags={editingTags}
                      pendingTag={editingPendingTag}
                      availableTags={availableTags}
                      onTagsChange={setEditingTags}
                      onPendingTagChange={setEditingPendingTag}
                      disabled={savingCardId === card.id}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={savingCardId === card.id}
                        onClick={() => void handleSaveCard(card.id)}
                      >
                        {savingCardId === card.id ? "Saving..." : "Save card"}
                      </Button>
                      <Button
                        type="button"
                        disabled={savingCardId === card.id}
                        onClick={cancelEditing}
                        variant="secondary"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-4">
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
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          disabled={isDemoUser || deletingCardId === card.id}
                          onClick={() => startEditing(card)}
                          variant="secondary"
                        >
                          Edit card
                        </Button>
                        <Button
                          type="button"
                          disabled={isDemoUser || deletingCardId === card.id}
                          onClick={() => void handleDeleteCard(card.id)}
                          variant="danger"
                        >
                          {deletingCardId === card.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <CardDifficultyBadge card={card} />
                      {deckNamesById[card.deckId] ? (
                        <Link
                          href={getDeckHref(card.deckId)}
                          aria-label={`Open deck ${deckNamesById[card.deckId]}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-text-secondary transition duration-fast hover:border-border-strong hover:bg-white/[0.08] hover:text-white"
                        >
                          <span>{deckNamesById[card.deckId]}</span>
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                            <path d="M3.5 8h9" />
                            <path d="m8.5 3 4.5 5-4.5 5" />
                          </svg>
                        </Link>
                      ) : null}
                      {card.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </AppPage>
  );
}
