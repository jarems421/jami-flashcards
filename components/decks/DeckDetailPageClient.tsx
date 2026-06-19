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
  exportCardsToSeparatedText,
  getCardContentKey,
  mapCardData,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardContentInput,
  type Card,
} from "@/lib/study/cards";
import { getCardContentDuplicateCounts, getCardQualityWarnings } from "@/lib/study/card-quality";
import { useUser } from "@/lib/auth/user-context";
import AppPage from "@/components/layout/AppPage";
import CardCreationPanel from "@/components/decks/CardCreationPanel";
import CardActionsMenu from "@/components/decks/CardActionsMenu";
import CardFaceSummary from "@/components/decks/CardFaceSummary";
import BulkTopicToolbar from "@/components/topics/BulkTopicToolbar";
import { getBulkTopicCapacity } from "@/lib/practice/topic-management";
import TopicPicker from "@/components/topics/TopicPicker";
import CardQualityWarnings from "@/components/decks/CardQualityWarnings";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import CardDifficultyBadge from "@/components/study/CardDifficultyBadge";
import { useCardSelection } from "@/components/decks/useCardSelection";
import { Button, Card as SurfaceCard, ConfirmDialog, EmptyState, FeedbackBanner, Input, Skeleton, StudyText } from "@/components/ui";
import { getDeckById, type Deck } from "@/services/study/decks";
import { getActiveTopics } from "@/services/study/topics";
import { MAX_LINKED_TOPICS, type Topic } from "@/lib/practice/topics";
import { db } from "@/services/firebase/client";
import { getDeckStudyHref } from "@/lib/app/routes";
import { featureFlags } from "@/lib/app/feature-flags";

function sanitizeFileName(value: string) {
  const normalized = value.trim().replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
  return normalized || "flashcards";
}

function downloadTextFile(fileName: string, text: string, type: string) {
  const content = type.startsWith("text/csv") ? `\uFEFF${text}` : text;
  const blob = new Blob([content], { type });
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
  const { user, isDemoUser } = useUser();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingFront, setEditingFront] = useState("");
  const [editingBack, setEditingBack] = useState("");
  const [editingTopicIds, setEditingTopicIds] = useState<string[]>([]);
  const [savingCardId, setSavingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [cardPendingDeleteId, setCardPendingDeleteId] = useState<string | null>(
    null
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [bulkTopicIds, setBulkTopicIds] = useState<string[]>([]);
  const [applyingBulkTopics, setApplyingBulkTopics] = useState(false);

  useEffect(() => {
    if (!deckId) {
      setDeck(null);
      setCards([]);
      setTopics([]);
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
        const [snapshot, nextTopics] = await Promise.all([
          getDocs(deckCardsQuery),
          getActiveTopics(user.uid).catch(() => []),
        ]);

        if (cancelled) {
          return;
        }

        const nextCards = snapshot.docs.map((cardDoc) =>
          mapCardData(cardDoc.id, cardDoc.data() as Record<string, unknown>)
        );
        nextCards.sort((left, right) => right.createdAt - left.createdAt);

        setDeck(ownedDeck);
        setCards(nextCards);
        setTopics(nextTopics);
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setDeck(null);
          setCards([]);
          setTopics([]);
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

  useEffect(() => {
    if (!previewCardId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewCardId(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewCardId]);

  const resetEditingCard = () => {
    setEditingCardId(null);
    setEditingFront("");
    setEditingBack("");
    setEditingTopicIds([]);
    setSavingCardId(null);
  };

  const startEditingCard = (card: Card) => {
    setEditingCardId(card.id);
    setEditingFront(card.front);
    setEditingBack(card.back);
    setEditingTopicIds(card.topicIds ?? []);
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

    if (meta.selectCreated) {
      setSelectedCardIds(createdCards.map((card) => card.id));
      setBulkTopicIds([]);
    }
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
    if (isDemoUser) {
      setFeedback({
        type: "error",
        message: "Card editing is disabled in the shared demo account.",
      });
      return;
    }

    const nextFront = normalizeCardContentInput(editingFront);
    const nextBack = normalizeCardContentInput(editingBack);

    if (!nextFront || !nextBack) {
      setFeedback({
        type: "error",
        message: "Both front and back are required.",
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

    const nextTopicIds = editingTopicIds;

    setSavingCardId(cardId);
    setFeedback(null);

    try {
      await updateDoc(doc(db, "cards", cardId), {
        front: nextFront,
        back: nextBack,
        tags: [],
        topicIds: nextTopicIds,
      });

      setCards((prev) =>
        prev.map((card) =>
          card.id === cardId
            ? {
                ...card,
                front: nextFront,
                back: nextBack,
                tags: [],
                topicIds: nextTopicIds,
              }
            : card
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
    if (isDemoUser) {
      setFeedback({
        type: "error",
        message: "Card deletion is disabled in the shared demo account.",
      });
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
      setCardPendingDeleteId(null);
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

  const deckTopicCount = new Set(cards.flatMap((card) => card.topicIds ?? [])).size;
  const topicsById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics]);
  const filteredCards = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return cards;
    }

    return cards.filter(
      (card) =>
        card.front.toLowerCase().includes(term) ||
        card.back.toLowerCase().includes(term) ||
        (card.topicIds ?? []).some((topicId) =>
          topicsById.get(topicId)?.name.toLowerCase().includes(term)
        )
    );
  }, [cards, searchTerm, topicsById]);
  const visibleCardIds = useMemo(() => filteredCards.map((card) => card.id), [filteredCards]);
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
      <ConfirmDialog
        open={cardPendingDeleteId !== null}
        title="Delete this card?"
        description="This permanently removes the card from this deck and its review queue. This cannot be undone."
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

      {deck ? (
        <>
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-text-muted">
            <Link href="/dashboard/decks" className="font-medium transition hover:text-text-primary">
              Decks
            </Link>
            <span aria-hidden="true">/</span>
            <span className="truncate text-text-secondary">{deck.name}</span>
          </nav>
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1.12fr)_320px]">
            <SurfaceCard padding="lg">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                Deck
              </div>
              <div className="mt-3 flex items-center gap-4">
                <DeckCoverIcon colorPreset={deck.colorPreset} iconPreset={deck.iconPreset} className="h-16 w-16" />
                <h1 className="min-w-0 truncate text-2xl font-medium tracking-tight sm:text-3xl">
                  {deck.name}
                </h1>
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                Open cards, tighten wording, and keep this topic ready to study.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 sm:mt-8">
                <Link
                  href={getDeckStudyHref(deck.id)}
                  className="inline-flex min-h-[3rem] items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition duration-fast ease-spring hover:-translate-y-[1px] hover:bg-accent-hover hover:shadow-[0_20px_40px_rgba(183,124,255,0.42)]"
                >
                  Study this deck
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
                At a glance
              </div>
              <div className="mt-4 grid gap-4">
                <div>
                  <div className="text-xs text-text-muted">Cards</div>
                  <div className="mt-1 text-2xl font-medium sm:text-3xl">{cards.length}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Topics</div>
                  <div className="mt-1 text-2xl font-medium sm:text-3xl">{deckTopicCount}</div>
                </div>
              </div>
              <details className="group/export mt-5">
                <summary
                  aria-disabled={cards.length === 0}
                  className={`app-button-secondary inline-flex min-h-[2.75rem] min-w-[7.5rem] list-none items-center justify-center rounded-[2rem] px-5 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden ${
                    cards.length === 0
                      ? "pointer-events-none opacity-60"
                      : "cursor-pointer"
                  }`}
                >
                  Export
                </summary>
                <div className="mt-2 grid gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-1.5 text-left">
                  <button
                    type="button"
                    className="rounded-lg px-3 py-2 text-left transition hover:bg-[var(--color-glass-subtle)]"
                    onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      handleExportCards("tsv");
                    }}
                  >
                    <span className="block text-sm font-medium text-text-primary">
                      Tab-separated list
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      Best for re-importing cards
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-2 text-left transition hover:bg-[var(--color-glass-subtle)]"
                    onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      handleExportCards("csv");
                    }}
                  >
                    <span className="block text-sm font-medium text-text-primary">
                      Spreadsheet CSV
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      Best for Excel or Google Sheets
                    </span>
                  </button>
                </div>
              </details>
            </SurfaceCard>
          </div>

          {isDemoUser ? (
            <div className="rounded-[1.6rem] border border-white/[0.08] bg-white/[0.04] p-4 text-sm text-text-secondary">
              <div className="font-semibold text-white">Card editing is locked in the shared demo</div>
              <p className="mt-1 leading-6">
                You can inspect the seeded cards in this deck, but creating, editing, and bulk Topic changes are reserved for private accounts.
              </p>
            </div>
          ) : (
            <CardCreationPanel
              userId={user.uid}
              decks={[deck]}
              existingCards={cards}
              topics={topics}
              onTopicsChange={setTopics}
              defaultDeckId={deck.id}
              onCardsCreated={handleCardsCreated}
              onFeedback={setFeedback}
            />
          )}

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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : deck && cards.length === 0 ? (
        <EmptyState
          emoji="Cards"
          eyebrow="Empty deck"
          title="No cards yet"
          description="This deck is ready for its first cards. Add a prompt and answer above, and it will join study automatically."
          helperText="New cards automatically join Daily Review when they need practice."
        />
      ) : deck ? (
        <>
          <Input
            placeholder="Search this deck"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          {!isDemoUser ? (
            <BulkTopicToolbar
              userId={user.uid}
              selectedCount={selectedCardIds.length}
              visibleCount={filteredCards.length}
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
          ) : null}

          {filteredCards.length === 0 ? (
            <EmptyState
              emoji="Search"
              eyebrow="No match"
              title="No cards match"
              description={`No cards match "${searchTerm.trim()}". Try a shorter search or check the global Cards page.`}
              action={<Button type="button" variant="secondary" onClick={() => setSearchTerm("")}>Clear search</Button>}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredCards.map((card) => (
                <section
                  key={card.id}
                  className={`app-panel min-w-0 overflow-visible p-3 transition duration-fast has-[details[open]]:z-40 ${
                    editingCardId === card.id ? "sm:col-span-2" : ""
                  } ${selectedCardIdSet.has(card.id) ? "ring-2 ring-accent/35" : ""}`}
                >
                  {editingCardId === card.id ? (
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
                      {featureFlags.enableFlashcardAi ? (
                        <CardBackAutocomplete
                          front={editingFront}
                          currentBack={editingBack}
                          deckId={deckId}
                          deckName={deck.name}
                          topics={editingTopicIds
                            .map((topicId) => topicsById.get(topicId)?.name)
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
                          onClick={resetEditingCard}
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
                            onPreview={() => setPreviewCardId(card.id)}
                            onEdit={() => startEditingCard(card)}
                            onDelete={() => setCardPendingDeleteId(card.id)}
                          />
                        </div>
                      </div>

                      <div className="mt-auto flex flex-wrap gap-1.5">
                        <CardDifficultyBadge card={card} compact />
                        <CardQualityWarnings
                          warnings={getCardQualityWarnings(card, {
                            duplicateCount: duplicateCounts.get(getCardContentKey(card.front, card.back)),
                          })}
                        />
                        {(card.topicIds ?? []).map((topicId) => {
                          const topic = topicsById.get(topicId);
                          if (!topic) return null;

                          return (
                            <span
                              key={topicId}
                              className="max-w-full rounded-full border border-warm-border bg-warm-glow px-2.5 py-1 text-[0.68rem] font-medium text-warm-accent"
                            >
                              <span className="block truncate">{topic.name}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      ) : null}
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
                  {deck?.name ?? "Deck"}
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
                    startEditingCard(previewCard);
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
