"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  addCardTag,
  mapCardData,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardTags,
  type Card,
} from "@/lib/study/cards";
import { useUser } from "@/lib/auth/user-context";
import AppPage from "@/components/layout/AppPage";
import TagInput from "@/components/decks/TagInput";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";
import CardDifficultyBadge from "@/components/study/CardDifficultyBadge";
import { Button, Card as SurfaceCard, EmptyState, FeedbackBanner, Input, Skeleton } from "@/components/ui";
import { getDeckById, type Deck } from "@/services/study/decks";
import { db } from "@/services/firebase/client";

export default function DeckDetailPageClient() {
  const params = useParams();
  const rawId = params?.id;
  const deckId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");
  const { user } = useUser();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [cardTags, setCardTags] = useState<string[]>([]);
  const [pendingTag, setPendingTag] = useState("");
  const [adding, setAdding] = useState(false);
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

  const handleAddCard = async () => {
    if (!deckId || !deck) {
      return;
    }

    const nextFront = front.trim();
    const nextBack = back.trim();
    const tagResult = addCardTag(cardTags, pendingTag);

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

    setAdding(true);
    setFeedback(null);

    try {
      const createdAt = Date.now();
      const nextTags = tagResult.nextTags;
      const ref = await addDoc(collection(db, "cards"), {
        deckId,
        userId: user.uid,
        front: nextFront,
        back: nextBack,
        tags: nextTags,
        createdAt,
      });

      setCards((prev) => [
        {
          id: ref.id,
          deckId,
          userId: user.uid,
          front: nextFront,
          back: nextBack,
          tags: nextTags,
          createdAt,
        },
        ...prev,
      ]);
      setFront("");
      setBack("");
      setCardTags([]);
      setPendingTag("");
      setAvailableTags((prev) =>
        Array.from(new Set([...prev, ...nextTags])).sort((left, right) =>
          left.localeCompare(right)
        )
      );
      setFeedback({
        type: "success",
        message: "Card added.",
      });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: "Failed to add card.",
      });
    } finally {
      setAdding(false);
    }
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

  return (
    <AppPage
      title={deck?.name ?? "Deck"}
      backHref="/dashboard/decks"
      backLabel="Decks"
      width="2xl"
      contentClassName="space-y-6"
    >
      {feedback ? (
        <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} />
      ) : null}

      {deck ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.12fr)_320px]">
            <SurfaceCard padding="lg">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                Deck editor
              </div>
              <div className="mt-3 flex items-center gap-4">
                <DeckCoverIcon colorPreset={deck.colorPreset} iconPreset={deck.iconPreset} className="h-16 w-16" />
                <h1 className="min-w-0 truncate text-3xl font-bold tracking-tight sm:text-4xl">
                  {deck.name}
                </h1>
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-text-secondary sm:text-base">
                Edit prompts, answers, and tags.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
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
                  <div className="mt-1 text-3xl font-semibold">{cards.length}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">Tags</div>
                  <div className="mt-1 text-3xl font-semibold">{deckTagCount}</div>
                </div>
              </div>
            </SurfaceCard>
          </div>

          <SurfaceCard padding="lg">
            <div className="space-y-6">
              <div>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                  Add a card
                </div>
                <p className="mt-3 text-sm leading-7 text-text-secondary sm:text-base">
                  Add the prompt, answer, and any tags.
                </p>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Input
                  label="Front"
                  placeholder="Question, prompt, or cue"
                  value={front}
                  onChange={(event) => setFront(event.target.value)}
                  maxLength={MAX_FRONT_LENGTH}
                />
                <Input
                  label="Back"
                  placeholder="Answer or explanation"
                  value={back}
                  onChange={(event) => setBack(event.target.value)}
                  maxLength={MAX_BACK_LENGTH}
                />
              </div>

              <TagInput
                tags={cardTags}
                pendingTag={pendingTag}
                availableTags={availableTags}
                onTagsChange={setCardTags}
                onPendingTagChange={setPendingTag}
                helperText="Reuse existing topics as you type, or add a new one for this card."
                disabled={adding}
              />

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  disabled={adding || !deckId || !deck}
                  onClick={() => void handleAddCard()}
                  size="lg"
                >
                  {adding ? "Adding..." : "Add Card"}
                </Button>
              </div>
            </div>
          </SurfaceCard>
        </>
      ) : !loadingCards ? (
        <SurfaceCard tone="warm" padding="md">
          <p className="text-sm leading-6 text-text-secondary">
            This deck does not exist or is no longer available.
          </p>
        </SurfaceCard>
      ) : null}

      {deck && loadingCards ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : deck && cards.length === 0 ? (
        <EmptyState
          emoji="📚"
          title="No cards yet"
          description="Add your first card above to start shaping this deck."
        />
      ) : deck ? (
        <>
          <Input
            placeholder="Search cards in this deck..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          {(() => {
            const term = searchTerm.trim().toLowerCase();
            const filteredCards = term
              ? cards.filter(
                  (card) =>
                    card.front.toLowerCase().includes(term) ||
                    card.back.toLowerCase().includes(term) ||
                    card.tags.some((tag) => tag.toLowerCase().includes(term))
                )
              : cards;

            if (filteredCards.length === 0) {
              return (
                <EmptyState
                  emoji="🔍"
                  title="No cards match"
                  description={`No cards match \u201c${searchTerm.trim()}\u201d.`}
                />
              );
            }

            return (
              <div className="grid gap-4 lg:grid-cols-2">
                {filteredCards.map((card) => (
            <section key={card.id} className="app-panel p-4">
                {editingCardId === card.id ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <CardDifficultyBadge card={card} />
                  </div>
                  <Input
                    label="Front"
                    value={editingFront}
                    onChange={(event) => setEditingFront(event.target.value)}
                  />
                  <Input
                    label="Back"
                    value={editingBack}
                    onChange={(event) => setEditingBack(event.target.value)}
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
                      <div className="text-lg font-semibold leading-7 text-white">
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
                    {card.tags.length > 0 ? (
                      <>
                      {card.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"
                        >
                          {tag}
                        </span>
                      ))}
                      </>
                    ) : null}
                  </div>
                </div>
              )}
            </section>
          ))}
              </div>
            );
          })()}
        </>
      ) : null}
    </AppPage>
  );
}
