"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { useUser } from "@/lib/auth/user-context";
import { db } from "@/services/firebase/client";
import { getDecks, type Deck } from "@/services/study/decks";
import {
  addCardTag,
  mapCardData,
  normalizeCardTags,
  MAX_FRONT_LENGTH,
  MAX_BACK_LENGTH,
  type Card,
} from "@/lib/study/cards";
import { getDeckHref } from "@/lib/app/routes";
import AppPage from "@/components/layout/AppPage";
import TagInput from "@/components/decks/TagInput";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import CardDifficultyBadge from "@/components/study/CardDifficultyBadge";
import { Button, EmptyState, FeedbackBanner, Input, SectionHeader, Skeleton } from "@/components/ui";
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
  const { user } = useUser();

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
  const [addDeckId, setAddDeckId] = useState("");
  const [addFront, setAddFront] = useState("");
  const [addBack, setAddBack] = useState("");
  const [addTags, setAddTags] = useState<string[]>([]);
  const [addPendingTag, setAddPendingTag] = useState("");
  const [addingCard, setAddingCard] = useState(false);
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
    const nextFront = editingFront.trim();
    const nextBack = editingBack.trim();
    const tagResult = addCardTag(editingTags, editingPendingTag);

    if (!nextFront || !nextBack) {
      setFeedback({ type: "error", message: "Both front and back are required." });
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
    const shouldDelete = window.confirm("Delete this card?");
    if (!shouldDelete) return;

    setDeletingCardId(cardId);
    setFeedback(null);

    try {
      await deleteDoc(doc(db, "cards", cardId));
      setCards((prev) => prev.filter((card) => card.id !== cardId));
      if (expandedCardId === cardId) cancelEditing();
      setFeedback({ type: "success", message: "Card deleted." });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to delete card." });
    } finally {
      setDeletingCardId(null);
    }
  };

  const handleAddCard = async () => {
    const nextFront = addFront.trim();
    const nextBack = addBack.trim();
    if (!addDeckId) {
      setFeedback({ type: "error", message: "Select a deck first." });
      return;
    }
    if (!nextFront || !nextBack) {
      setFeedback({ type: "error", message: "Both front and back are required." });
      return;
    }
    if (nextFront.length > MAX_FRONT_LENGTH || nextBack.length > MAX_BACK_LENGTH) {
      setFeedback({ type: "error", message: `Cards must stay under ${MAX_FRONT_LENGTH} / ${MAX_BACK_LENGTH} characters.` });
      return;
    }
    const tagResult = addCardTag(addTags, addPendingTag);
    if (tagResult.error) {
      setFeedback({ type: "error", message: tagResult.error });
      return;
    }

    setAddingCard(true);
    setFeedback(null);

    try {
      const createdAt = Date.now();
      const nextTags = tagResult.nextTags;
      const ref = await addDoc(collection(db, "cards"), {
        deckId: addDeckId,
        userId: user.uid,
        front: nextFront,
        back: nextBack,
        tags: nextTags,
        createdAt,
      });

      setCards((prev) => [
        {
          id: ref.id,
          deckId: addDeckId,
          userId: user.uid,
          front: nextFront,
          back: nextBack,
          tags: nextTags,
          createdAt,
        },
        ...prev,
      ]);
      setAddFront("");
      setAddBack("");
      setAddTags([]);
      setAddPendingTag("");
      setAvailableTags((prev) =>
        Array.from(new Set([...prev, ...nextTags])).sort((a, b) => a.localeCompare(b))
      );
      setFeedback({ type: "success", message: "Card added." });
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to add card." });
    } finally {
      setAddingCard(false);
    }
  };

  return (
    <AppPage
      title="Cards"
      backHref="/dashboard"
      backLabel="Home"
      width="2xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      {feedback ? (
        <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />
      ) : null}

      <div className="app-panel p-3 sm:p-4">
        <SectionHeader
          eyebrow="Create"
          title="Add card"
          description="Write the front and back, then add tags only if they help you find it later."
          action={
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.2rem] border border-white/20 bg-[linear-gradient(180deg,#fff8fd,#ffdff4)] text-2xl font-black text-[#10091d] shadow-[0_4px_0_rgba(0,0,0,0.18)]">
              +
            </div>
          }
        />

        <div className="mt-3 space-y-3 sm:mt-4">
          <select
            value={addDeckId}
            onChange={(e) => setAddDeckId(e.target.value)}
            className="w-full appearance-none rounded-[2rem] border-[1.5px] border-white/[0.14] bg-surface-panel-strong px-5 py-[1rem] text-sm text-white outline-none transition duration-fast hover:border-white/[0.20] focus:border-warm-accent focus:ring-4 focus:ring-accent/18"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 1rem center",
              paddingRight: "2.5rem",
            }}
          >
            <option value="" disabled>Select a deck</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          <div className="grid gap-3 lg:grid-cols-2">
            <Input
              placeholder="Front"
              value={addFront}
              onChange={(e) => setAddFront(e.target.value)}
              maxLength={MAX_FRONT_LENGTH}
            />
            <div className="space-y-3">
              <CardBackEditor
                label="Back"
                placeholder="Answer"
                value={addBack}
                onChange={setAddBack}
                maxLength={MAX_BACK_LENGTH}
                rows={6}
                disabled={addingCard}
              />
              <CardBackAutocomplete
                front={addFront}
                currentBack={addBack}
                deckId={addDeckId || undefined}
                deckName={addDeckId ? deckNamesById[addDeckId] : undefined}
                tags={addTags}
                disabled={addingCard}
                onApply={setAddBack}
              />
            </div>
          </div>

          <TagInput
            tags={addTags}
            pendingTag={addPendingTag}
            availableTags={availableTags}
            onTagsChange={setAddTags}
            onPendingTagChange={setAddPendingTag}
            disabled={addingCard}
          />

          <Button
            disabled={addingCard || !addDeckId || !addFront.trim() || !addBack.trim()}
            onClick={() => void handleAddCard()}
          >
            {addingCard ? "Adding..." : "Add card"}
          </Button>
        </div>
      </div>

      <div className="sticky top-0 z-20 -mx-1 px-1 pb-2 pt-1">
        <Input
          placeholder="Search cards..."
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
          emoji="📚"
          eyebrow="No cards yet"
          title="No cards yet"
          description="Cards are the fuel for Daily Review and Custom Review. Add a question and answer above to create your first one."
          helperText={decks.length === 0 ? "You will need a deck first, then cards can be added here." : "Once saved, new cards appear in study automatically."}
          action={decks.length === 0 ? <Link href="/dashboard/decks" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast hover:bg-accent-hover">Create a deck</Link> : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          emoji="🔍"
          eyebrow="No match"
          title="No cards match"
          description={`No cards match "${debouncedTerm}". Try a shorter search, another deck name, or a tag you remember.`}
          action={<Button type="button" variant="secondary" onClick={() => setSearchTerm("")}>Clear search</Button>}
        />
      ) : (
        <>
          <p className="text-sm text-text-secondary">
            {filtered.length} card{filtered.length === 1 ? "" : "s"} found
            {hasMore ? ` (showing first ${MAX_VISIBLE_RESULTS})` : ""}
          </p>

          <div className="grid animate-slide-up gap-3 sm:gap-4 lg:grid-cols-2">
            {visibleCards.map((card) => (
              <section key={card.id} className="app-panel p-3 sm:p-4 transition duration-fast ease-spring hover:-translate-y-0.5 hover:shadow-shell">
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
                        {savingCardId === card.id ? "Saving..." : "Save"}
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
                        <div className="text-[0.95rem] font-semibold leading-6 text-white sm:text-base sm:leading-7">
                          {card.front}
                        </div>
                        <div className="text-sm leading-6 text-text-secondary">
                          {card.back}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          disabled={deletingCardId === card.id}
                          onClick={() => startEditing(card)}
                          variant="secondary"
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          disabled={deletingCardId === card.id}
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
                          className="rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-text-secondary transition duration-fast hover:bg-white/[0.08]"
                        >
                          {deckNamesById[card.deckId]}
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
