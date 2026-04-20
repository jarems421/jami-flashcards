"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  addCardTag,
  exportCardsToSeparatedText,
  mapCardData,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardTags,
  type Card,
} from "@/lib/study/cards";
import { useUser } from "@/lib/auth/user-context";
import AppPage from "@/components/layout/AppPage";
import TagInput from "@/components/decks/TagInput";
import CardCreationPanel from "@/components/decks/CardCreationPanel";
import BulkTagToolbar from "@/components/decks/BulkTagToolbar";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import CardDifficultyBadge from "@/components/study/CardDifficultyBadge";
import { Button, Card as SurfaceCard, EmptyState, FeedbackBanner, Input, Skeleton } from "@/components/ui";
import { getDeckById, type Deck } from "@/services/study/decks";
import { db } from "@/services/firebase/client";

function sanitizeFileName(value: string) {
  const normalized = value.trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
  return normalized || "flashcards";
}

function downloadTextFile(fileName: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function DeckDetailPageClient() {
  const params = useParams();
  const rawId = params?.id;
  const deckId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");
  const { user } = useUser();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingFront, setEditingFront] = useState("");
  const [editingBack, setEditingBack] = useState("");
  const [editingTags, setEditingTags] = useState<string[]>([]);
  const [editingPendingTag, setEditingPendingTag] = useState("");
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [bulkPendingTag, setBulkPendingTag] = useState("");
  const [applyingBulkTags, setApplyingBulkTags] = useState(false);

  useEffect(() => {
    if (!deckId) {
      setDeck(null);
      setCards([]);
      setAvailableTags([]);
      setLoadingCards(false);
      setFeedback({
        type: "error",
        message: "Deck not found.",
      });
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoadingCards(true);
      setFeedback(null);

      try {
        const ownedDeck = await getDeckById(user.uid, deckId);
        if (!ownedDeck) {
          if (!cancelled) {
            setDeck(null);
            setCards([]);
            setAvailableTags([]);
            setFeedback({
              type: "error",
              message: "Deck not found.",
            });
          }
          return;
        }

        const deckCardsQuery = query(
          collection(db, "cards"),
          where("deckId", "==", deckId),
          where("userId", "==", user.uid)
        );
        const userCardsQuery = query(
          collection(db, "cards"),
          where("userId", "==", user.uid)
        );

        const [snapshot, allUserCardsSnapshot] = await Promise.all([
          getDocs(deckCardsQuery),
          getDocs(userCardsQuery),
        ]);

        if (cancelled) {
          return;
        }

        const nextCards = snapshot.docs.map((cardDoc) =>
          mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>)
        );
        nextCards.sort((left, right) => right.createdAt - left.createdAt);

        const nextAvailableTags = Array.from(
          new Set(
            allUserCardsSnapshot.docs.flatMap((cardDoc) =>
              normalizeCardTags(cardDoc.data().tags)
            )
          )
        ).sort((left, right) => left.localeCompare(right));

        setDeck(ownedDeck);
        setCards(nextCards);
        setAvailableTags(nextAvailableTags);
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setDeck(null);
          setCards([]);
          setAvailableTags([]);
          setFeedback({
            type: "error",
            message: "Failed to load cards.",
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingCards(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user.uid, deckId]);

  const resetEditingCard = () => {
    setEditingCardId(null);
    setEditingFront("");
    setEditingBack("");
    setEditingTags([]);
    setEditingPendingTag("");
    setSavingCardId(null);
  };

  const startEditingCard = (card: Card) => {
    setEditingCardId(card.id);
    setEditingFront(card.front);
    setEditingBack(card.back);
    setEditingTags(card.tags);
    setEditingPendingTag("");
    setFeedback(null);
  };

  const addCreatedCardsToList = (createdCards: Card[]) => {
    if (createdCards.length === 0) {
      return;
    }

    setCards((prev) => {
      const existingIds = new Set(prev.map((card) => card.id));
      const freshCards = createdCards.filter((card) => !existingIds.has(card.id));
      return [...freshCards, ...prev];
    });
  };

  const handleCardsCreated = (
    createdCards: Card[],
    meta: { selectCreated: boolean }
  ) => {
    addCreatedCardsToList(createdCards);
    setAvailableTags((prev) =>
      Array.from(new Set([...prev, ...createdCards.flatMap((card) => card.tags)])).sort((left, right) =>
        left.localeCompare(right)
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

  const handleExportCards = (format: "tsv" | "csv") => {
    if (!deck || cards.length === 0) {
      setFeedback({
        type: "error",
        message: "Add cards before exporting this deck.",
      });
      return;
    }

    const sortedCards = [...cards].sort((left, right) => left.createdAt - right.createdAt);
    const text = exportCardsToSeparatedText(sortedCards, format);
    const extension = format === "csv" ? "csv" : "tsv";
    downloadTextFile(
      `${sanitizeFileName(deck.name)}-flashcards.${extension}`,
      text,
      format === "csv" ? "text/csv;charset=utf-8" : "text/tab-separated-values;charset=utf-8"
    );
    setFeedback({
      type: "success",
      message: `Downloaded ${cards.length} cards.`,
    });
  };

  const handleSaveCard = async (cardId: string) => {
    const nextFront = editingFront.trim();
    const nextBack = editingBack.trim();
    const tagResult = addCardTag(editingTags, editingPendingTag);

    if (!nextFront || !nextBack) {
      setFeedback({
        type: "error",
        message: "Both front and back are required.",
      });
      return;
    }

    if (tagResult.error) {
      setFeedback({
        type: "error",
        message: tagResult.error,
      });
      return;
    }

    if (
      nextFront.length > MAX_FRONT_LENGTH ||
      nextBack.length > MAX_BACK_LENGTH
    ) {
      setFeedback({
        type: "error",
        message: `Cards must stay under ${MAX_FRONT_LENGTH} characters on the front and ${MAX_BACK_LENGTH} on the back.`,
      });
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
            ? {
                ...card,
                front: nextFront,
                back: nextBack,
                tags: nextTags,
              }
            : card
        )
      );
      setAvailableTags((prev) =>
        Array.from(new Set([...prev, ...nextTags])).sort((left, right) =>
          left.localeCompare(right)
        )
      );
      resetEditingCard();
      setFeedback({
        type: "success",
        message: "Card updated.",
      });
    } catch (error) {
      console.error(error);
      setSavingCardId(null);
      setFeedback({
        type: "error",
        message: "Failed to update card.",
      });
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    const shouldDelete = window.confirm("Delete this card?");
    if (!shouldDelete) {
      return;
    }

    setDeletingCardId(cardId);
    setFeedback(null);

    try {
      await deleteDoc(doc(db, "cards", cardId));
      setCards((prev) => prev.filter((card) => card.id !== cardId));
      setSelectedCardIds((prev) => prev.filter((selectedId) => selectedId !== cardId));
      if (editingCardId === cardId) {
        resetEditingCard();
      }
      setFeedback({
        type: "success",
        message: "Card deleted.",
      });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: "Failed to delete card.",
      });
    } finally {
      setDeletingCardId(null);
    }
  };

  const deckTagCount = Array.from(new Set(cards.flatMap((card) => card.tags))).length;
  const filteredCards = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return cards;
    }

    return cards.filter(
      (card) =>
        card.front.toLowerCase().includes(term) ||
        card.back.toLowerCase().includes(term) ||
        card.tags.some((tag) => tag.toLowerCase().includes(term))
    );
  }, [cards, searchTerm]);
  const selectedCardIdSet = useMemo(() => new Set(selectedCardIds), [selectedCardIds]);

  const selectFilteredCards = () => {
    setSelectedCardIds((prev) =>
      Array.from(new Set([...prev, ...filteredCards.map((card) => card.id)]))
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
        Array.from(new Set([...prev, ...nextBulkTags])).sort((left, right) =>
          left.localeCompare(right)
        )
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
      title={deck?.name ?? "Deck"}
      backHref="/dashboard/decks"
      backLabel="Decks"
      width="2xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      {feedback ? (
        <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />
      ) : null}

      {deck ? (
        <>
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1.12fr)_320px]">
            <SurfaceCard padding="lg">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                Deck editor
              </div>
              <div className="mt-3 flex items-center gap-4">
                <DeckCoverIcon colorPreset={deck.colorPreset} iconPreset={deck.iconPreset} className="h-16 w-16" />
                <h1 className="min-w-0 truncate text-2xl font-medium tracking-tight sm:text-3xl">
                  {deck.name}
                </h1>
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                Edit prompts, answers, and tags.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 sm:mt-8">
                <Link
                  href="/dashboard/study?mode=custom"
                  className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover hover:shadow-[0_20px_40px_rgba(183,124,255,0.42)]"
                >
                  Open study hub
                </Link>
                <Link
                  href="/dashboard/decks"
                  className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl border border-border bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition duration-fast hover:border-border-strong hover:bg-white/[0.07]"
                >
                  Back to decks
                </Link>
              </div>
            </SurfaceCard>

            <SurfaceCard tone="warm" padding="md">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                Deck summary
              </div>
              <div className="mt-4 grid gap-4">
                <div>
                  <div className="text-xs text-text-muted">Cards</div>
                  <div className="mt-1 text-2xl font-medium sm:text-3xl">{cards.length}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Tags</div>
                  <div className="mt-1 text-2xl font-medium sm:text-3xl">{deckTagCount}</div>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={cards.length === 0}
                  onClick={() => handleExportCards("tsv")}
                >
                  Download list
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={cards.length === 0}
                  onClick={() => handleExportCards("csv")}
                >
                  Download for spreadsheet
                </Button>
              </div>
            </SurfaceCard>
          </div>

          <CardCreationPanel
            userId={user.uid}
            decks={[deck]}
            existingCards={cards}
            availableTags={availableTags}
            defaultDeckId={deck.id}
            onCardsCreated={handleCardsCreated}
            onFeedback={setFeedback}
          />

        </>
      ) : !loadingCards ? (
        <EmptyState
          emoji="Deck"
          eyebrow="Deck unavailable"
          title="This deck is not available"
          description="It may have been deleted or moved. Go back to your deck list to keep organising cards."
          action={<Link href="/dashboard/decks" className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast hover:bg-accent-hover">Back to decks</Link>}
        />
      ) : null}

      {deck && loadingCards ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : deck && cards.length === 0 ? (
        <EmptyState
          emoji="Cards"
          eyebrow="Empty deck"
          title="No cards yet"
          description="This deck is ready, it just needs its first flashcards. Add a front and back above to make it available for study."
          helperText="New cards automatically join Daily Review when they need practice."
        />
      ) : deck ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={selectFilteredCards}
              disabled={filteredCards.length === 0}
            >
              Select shown cards
            </Button>
            <span className="text-sm text-text-muted">
              {selectedCardIds.length} selected
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

          <Input
            placeholder="Search cards in this deck..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          {filteredCards.length === 0 ? (
            <EmptyState
              emoji="Search"
              eyebrow="No match"
              title="No cards match"
              description={`No cards match "${searchTerm.trim()}". Try a shorter search or check the global Cards page.`}
              action={<Button type="button" variant="secondary" onClick={() => setSearchTerm("")}>Clear search</Button>}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {filteredCards.map((card) => (
                <section key={card.id} className="app-panel p-4">
                  <label className="mb-3 flex w-fit items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs font-medium text-text-secondary">
                    <input
                      type="checkbox"
                      checked={selectedCardIdSet.has(card.id)}
                      onChange={() => toggleCardSelection(card.id)}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    Select
                  </label>
                  {editingCardId === card.id ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        <CardDifficultyBadge card={card} />
                      </div>
                      <Input
                        label="Front"
                        value={editingFront}
                        onChange={(event) => setEditingFront(event.target.value)}
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
                        deckId={deckId}
                        deckName={deck.name}
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
                        helperText="Suggestions come from tags you already use across all decks."
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
                          onClick={resetEditingCard}
                          variant="secondary"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="text-lg font-medium leading-7 text-white">
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
                            onClick={() => startEditingCard(card)}
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

                      <div className="flex flex-wrap gap-2 pt-1">
                        <CardDifficultyBadge card={card} />
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
          )}
        </>
      ) : null}
    </AppPage>
  );
}
