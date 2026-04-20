"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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
  writeBatch,
} from "firebase/firestore";
import {
  addCardTag,
  exportCardsToSeparatedText,
  getCardContentKey,
  mapCardData,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardTags,
  parseCardImportText,
  type Card,
  type ImportedCardDraft,
} from "@/lib/study/cards";
import {
  MAX_NOTES_FOR_CARD_GENERATION,
  MIN_NOTES_FOR_CARD_GENERATION,
  type GeneratedCardDraft,
} from "@/lib/ai/card-generation";
import { generateCardsFromNotes } from "@/services/ai/generate-cards";
import { useUser } from "@/lib/auth/user-context";
import AppPage from "@/components/layout/AppPage";
import TagInput from "@/components/decks/TagInput";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import CardDifficultyBadge from "@/components/study/CardDifficultyBadge";
import { Button, Card as SurfaceCard, EmptyState, FeedbackBanner, Input, Skeleton, Textarea } from "@/components/ui";
import { getDeckById, type Deck } from "@/services/study/decks";
import { db } from "@/services/firebase/client";

const CARD_IMPORT_BATCH_SIZE = 450;
type ImportProgress = { completed: number; total: number } | null;
type GeneratedReviewCard = GeneratedCardDraft & { selected: boolean };

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

function getNewDraftSummary(
  drafts: ImportedCardDraft[],
  existingKeys: Set<string>
) {
  const seenKeys = new Set<string>();
  const newDrafts: ImportedCardDraft[] = [];
  let duplicateCount = 0;

  for (const draft of drafts) {
    const key = getCardContentKey(draft.front, draft.back);
    if (existingKeys.has(key) || seenKeys.has(key)) {
      duplicateCount += 1;
      continue;
    }

    seenKeys.add(key);
    newDrafts.push(draft);
  }

  return { newDrafts, duplicateCount };
}

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
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importTags, setImportTags] = useState<string[]>([]);
  const [importPendingTag, setImportPendingTag] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress>(null);
  const [aiNotes, setAiNotes] = useState("");
  const [aiCardCount, setAiCardCount] = useState(8);
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [aiPendingTag, setAiPendingTag] = useState("");
  const [generatingCards, setGeneratingCards] = useState(false);
  const [savingGeneratedCards, setSavingGeneratedCards] = useState(false);
  const [generatedCards, setGeneratedCards] = useState<GeneratedReviewCard[]>([]);
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
  const importSummary = useMemo(() => parseCardImportText(importText), [importText]);
  const existingCardKeys = useMemo(
    () => new Set(cards.map((card) => getCardContentKey(card.front, card.back))),
    [cards]
  );
  const importDraftSummary = useMemo(
    () => getNewDraftSummary(importSummary.cards, existingCardKeys),
    [existingCardKeys, importSummary.cards]
  );
  const selectedGeneratedCards = useMemo(
    () =>
      generatedCards
        .filter((card) => card.selected)
        .map(({ front: generatedFront, back: generatedBack }) => ({
          front: generatedFront.trim(),
          back: generatedBack.trim(),
        }))
        .filter((card) => card.front && card.back),
    [generatedCards]
  );
  const generatedDraftSummary = useMemo(
    () => getNewDraftSummary(selectedGeneratedCards, existingCardKeys),
    [existingCardKeys, selectedGeneratedCards]
  );

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

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      setImportText(text);
      setImportFileName(file.name);
      setFeedback(null);
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: "Failed to read that file.",
      });
    } finally {
      input.value = "";
    }
  };

  const clearImportDraft = () => {
    setImportText("");
    setImportFileName("");
    setImportTags([]);
    setImportPendingTag("");
    setImportProgress(null);
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

  const createCardsFromDrafts = async (
    drafts: ImportedCardDraft[],
    tags: string[],
    onProgress?: (completed: number, total: number) => void
  ) => {
    const createdCards: Card[] = [];
    const createdAtBase = Date.now();
    const cardsCollection = collection(db, "cards");

    try {
      for (let start = 0; start < drafts.length; start += CARD_IMPORT_BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunkCards: Card[] = [];
        const chunk = drafts.slice(start, start + CARD_IMPORT_BATCH_SIZE);

        chunk.forEach((cardDraft, index) => {
          const cardIndex = start + index;
          const cardRef = doc(cardsCollection);
          const createdAt = createdAtBase - cardIndex;
          const card: Card = {
            id: cardRef.id,
            deckId,
            userId: user.uid,
            front: cardDraft.front,
            back: cardDraft.back,
            tags,
            createdAt,
          };

          batch.set(cardRef, {
            deckId,
            userId: user.uid,
            front: card.front,
            back: card.back,
            tags: card.tags,
            createdAt,
          });
          chunkCards.push(card);
        });

        await batch.commit();
        createdCards.push(...chunkCards);
        onProgress?.(createdCards.length, drafts.length);
      }

      return createdCards;
    } catch (error) {
      const errorWithCreatedCards = error instanceof Error ? error : new Error("Failed to create cards.");
      (errorWithCreatedCards as Error & { createdCards?: Card[] }).createdCards = createdCards;
      throw errorWithCreatedCards;
    }
  };

  const applyNewCardsToDeck = (createdCards: Card[], tags: string[]) => {
    addCreatedCardsToList(createdCards);
    setAvailableTags((prev) =>
      Array.from(new Set([...prev, ...tags])).sort((left, right) =>
        left.localeCompare(right)
      )
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
      message: `Exported ${cards.length} cards.`,
    });
  };

  const handleDownloadImportErrors = () => {
    if (importSummary.errors.length === 0) {
      return;
    }

    downloadTextFile(
      `${sanitizeFileName(deck?.name ?? "deck")}-import-errors.txt`,
      importSummary.errors.join("\n"),
      "text/plain;charset=utf-8"
    );
  };

  const handleImportCards = async () => {
    if (!deckId || !deck) {
      return;
    }

    if (importSummary.skippedRows > 0) {
      setFeedback({
        type: "error",
        message: "Fix the rows that need attention before importing.",
      });
      return;
    }

    if (importSummary.cards.length === 0) {
      setFeedback({
        type: "error",
        message: "Paste or upload cards before importing.",
      });
      return;
    }

    if (importDraftSummary.newDrafts.length === 0) {
      setFeedback({
        type: "error",
        message: "All detected cards are already in this deck.",
      });
      return;
    }

    const tagResult = addCardTag(importTags, importPendingTag);
    if (tagResult.error) {
      setFeedback({
        type: "error",
        message: tagResult.error,
      });
      return;
    }

    setImporting(true);
    setImportProgress({ completed: 0, total: importDraftSummary.newDrafts.length });
    setFeedback(null);

    const nextTags = tagResult.nextTags;

    try {
      const importedCards = await createCardsFromDrafts(
        importDraftSummary.newDrafts,
        nextTags,
        (completed, total) =>
          setImportProgress({
            completed,
            total,
          })
      );
      applyNewCardsToDeck(importedCards, nextTags);
      const duplicateMessage =
        importDraftSummary.duplicateCount > 0
          ? ` Skipped ${importDraftSummary.duplicateCount} duplicate${importDraftSummary.duplicateCount === 1 ? "" : "s"}.`
          : "";
      clearImportDraft();
      setFeedback({
        type: "success",
        message: `Imported ${importedCards.length} cards.${duplicateMessage}`,
      });
    } catch (error) {
      console.error(error);
      const createdCards =
        error instanceof Error
          ? ((error as Error & { createdCards?: Card[] }).createdCards ?? [])
          : [];
      applyNewCardsToDeck(createdCards, nextTags);
      setFeedback({
        type: "error",
        message:
          createdCards.length > 0
            ? `Imported ${createdCards.length} cards before the import stopped. Check the deck before retrying.`
            : "Failed to import cards.",
      });
    } finally {
      setImporting(false);
    }
  };

  const resetGeneratedCards = () => {
    setAiNotes("");
    setAiTags([]);
    setAiPendingTag("");
    setGeneratedCards([]);
  };

  const handleGenerateCards = async () => {
    if (!deck) {
      return;
    }

    if (aiNotes.trim().length < MIN_NOTES_FOR_CARD_GENERATION) {
      setFeedback({
        type: "error",
        message: `Paste at least ${MIN_NOTES_FOR_CARD_GENERATION} characters of notes before generating cards.`,
      });
      return;
    }

    const tagResult = addCardTag(aiTags, aiPendingTag);
    if (tagResult.error) {
      setFeedback({
        type: "error",
        message: tagResult.error,
      });
      return;
    }

    setGeneratingCards(true);
    setFeedback(null);

    try {
      const drafts = await generateCardsFromNotes({
        notes: aiNotes,
        deckName: deck.name,
        tags: tagResult.nextTags,
        count: aiCardCount,
      });
      setAiTags(tagResult.nextTags);
      setAiPendingTag("");
      setGeneratedCards(drafts.map((draft) => ({ ...draft, selected: true })));
      setFeedback({
        type: "success",
        message: `Generated ${drafts.length} draft cards. Review them before saving.`,
      });
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to generate cards from those notes.",
      });
    } finally {
      setGeneratingCards(false);
    }
  };

  const updateGeneratedCard = (
    index: number,
    field: "front" | "back" | "selected",
    value: string | boolean
  ) => {
    setGeneratedCards((prev) =>
      prev.map((card, cardIndex) =>
        cardIndex === index
          ? {
              ...card,
              [field]: value,
            }
          : card
        )
      );
  };

  const handleSaveGeneratedCards = async () => {
    if (!deckId || !deck) {
      return;
    }

    if (selectedGeneratedCards.length === 0) {
      setFeedback({
        type: "error",
        message: "Select at least one generated card to save.",
      });
      return;
    }

    if (generatedDraftSummary.newDrafts.length === 0) {
      setFeedback({
        type: "error",
        message: "The selected generated cards already exist in this deck.",
      });
      return;
    }

    const tagResult = addCardTag(aiTags, aiPendingTag);
    if (tagResult.error) {
      setFeedback({
        type: "error",
        message: tagResult.error,
      });
      return;
    }

    setSavingGeneratedCards(true);
    setFeedback(null);

    const nextTags = tagResult.nextTags;
    try {
      const createdCards = await createCardsFromDrafts(generatedDraftSummary.newDrafts, nextTags);
      applyNewCardsToDeck(createdCards, nextTags);
      const duplicateMessage =
        generatedDraftSummary.duplicateCount > 0
          ? ` Skipped ${generatedDraftSummary.duplicateCount} duplicate${generatedDraftSummary.duplicateCount === 1 ? "" : "s"}.`
          : "";
      resetGeneratedCards();
      setFeedback({
        type: "success",
        message: `Saved ${createdCards.length} generated cards.${duplicateMessage}`,
      });
    } catch (error) {
      console.error(error);
      const createdCards =
        error instanceof Error
          ? ((error as Error & { createdCards?: Card[] }).createdCards ?? [])
          : [];
      applyNewCardsToDeck(createdCards, nextTags);
      setFeedback({
        type: "error",
        message:
          createdCards.length > 0
            ? `Saved ${createdCards.length} cards before generation import stopped. Check the deck before retrying.`
            : "Failed to save generated cards.",
      });
    } finally {
      setSavingGeneratedCards(false);
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
                  Export TSV
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={cards.length === 0}
                  onClick={() => handleExportCards("csv")}
                >
                  Export CSV
                </Button>
              </div>
            </SurfaceCard>
          </div>

          <section className="app-panel p-4 sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.25rem] border border-white/20 bg-[linear-gradient(180deg,#fff8fd,#ffdff4)] text-2xl font-semibold text-[#10091d] shadow-[0_10px_20px_rgba(255,214,246,0.16)]">
                +
              </div>
              <div className="min-w-0">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                  Add card
                </div>
                <div className="mt-1 truncate text-lg font-semibold text-white">
                  Draft a new flashcard
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-4 animate-fade-in">
              <div className="grid gap-4 lg:grid-cols-2">
                <Input
                  label="Front"
                  placeholder="Question, prompt, or cue"
                  value={front}
                  onChange={(event) => setFront(event.target.value)}
                  maxLength={MAX_FRONT_LENGTH}
                />
                <div className="space-y-3">
                  <CardBackEditor
                    label="Back"
                    placeholder="Answer or explanation"
                    value={back}
                    onChange={setBack}
                    maxLength={MAX_BACK_LENGTH}
                    rows={6}
                    disabled={adding}
                  />
                  <CardBackAutocomplete
                    front={front}
                    currentBack={back}
                    deckId={deckId}
                    deckName={deck.name}
                    tags={cardTags}
                    disabled={adding}
                    onApply={setBack}
                  />
                </div>
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
                  {adding ? "Adding..." : "Add card"}
                </Button>
              </div>
            </div>
          </section>

          <section className="app-panel p-4 sm:p-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.25rem] border border-white/20 bg-[linear-gradient(180deg,#fff8fd,#ffdff4)] text-xl font-semibold text-[#10091d] shadow-[0_10px_20px_rgba(255,214,246,0.16)]">
                AI
              </div>
              <div className="min-w-0">
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                  Generate cards
                </div>
                <div className="mt-1 truncate text-lg font-semibold text-white">
                  Turn notes into drafts
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-4 animate-fade-in">
              <Textarea
                label="Notes"
                placeholder="Paste class notes, a textbook summary, or revision bullet points..."
                value={aiNotes}
                onChange={(event) => setAiNotes(event.target.value.slice(0, MAX_NOTES_FOR_CARD_GENERATION))}
                rows={8}
                disabled={generatingCards || savingGeneratedCards}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
                <span>
                  {aiNotes.trim().length.toLocaleString()} / {MAX_NOTES_FOR_CARD_GENERATION.toLocaleString()} characters
                </span>
                <span>
                  Minimum {MIN_NOTES_FOR_CARD_GENERATION} characters.
                </span>
              </div>

              <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                <Input
                  label="Draft count"
                  type="number"
                  min={3}
                  max={24}
                  value={aiCardCount}
                  onChange={(event) => {
                    const nextCount = Number(event.target.value);
                    setAiCardCount(Number.isFinite(nextCount) ? nextCount : 8);
                  }}
                  disabled={generatingCards || savingGeneratedCards}
                />
                <TagInput
                  tags={aiTags}
                  pendingTag={aiPendingTag}
                  availableTags={availableTags}
                  onTagsChange={setAiTags}
                  onPendingTagChange={setAiPendingTag}
                  helperText="These tags guide generation and are saved onto accepted cards."
                  disabled={generatingCards || savingGeneratedCards}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  disabled={generatingCards || savingGeneratedCards || aiNotes.trim().length < MIN_NOTES_FOR_CARD_GENERATION}
                  onClick={() => void handleGenerateCards()}
                  size="lg"
                >
                  {generatingCards ? "Generating..." : "Generate draft cards"}
                </Button>
                <Button
                  type="button"
                  disabled={generatingCards || savingGeneratedCards || (!aiNotes && generatedCards.length === 0)}
                  onClick={resetGeneratedCards}
                  variant="ghost"
                  size="lg"
                >
                  Clear AI drafts
                </Button>
              </div>

              {generatedCards.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-sm text-text-secondary">
                    <span>
                      {generatedDraftSummary.newDrafts.length} selected card{generatedDraftSummary.newDrafts.length === 1 ? "" : "s"} ready
                    </span>
                    {generatedDraftSummary.duplicateCount > 0 ? (
                      <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-medium text-warm-accent">
                        {generatedDraftSummary.duplicateCount} duplicate{generatedDraftSummary.duplicateCount === 1 ? "" : "s"} skipped
                      </span>
                    ) : null}
                  </div>

                  {generatedCards.map((card, index) => (
                    <div
                      key={`${card.front}-${index}`}
                      className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4"
                    >
                      <label className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                        <input
                          type="checkbox"
                          checked={card.selected}
                          onChange={(event) => updateGeneratedCard(index, "selected", event.target.checked)}
                          disabled={savingGeneratedCards}
                          className="h-4 w-4 accent-[var(--color-accent)]"
                        />
                        Save this card
                      </label>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <Input
                          label="Front"
                          value={card.front}
                          maxLength={MAX_FRONT_LENGTH}
                          onChange={(event) => updateGeneratedCard(index, "front", event.target.value)}
                          disabled={savingGeneratedCards}
                        />
                        <Textarea
                          label="Back"
                          value={card.back}
                          maxLength={MAX_BACK_LENGTH}
                          onChange={(event) => updateGeneratedCard(index, "back", event.target.value)}
                          rows={4}
                          disabled={savingGeneratedCards}
                        />
                      </div>
                    </div>
                  ))}

                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      disabled={savingGeneratedCards || generatedDraftSummary.newDrafts.length === 0}
                      onClick={() => void handleSaveGeneratedCards()}
                      size="lg"
                    >
                      {savingGeneratedCards
                        ? "Saving..."
                        : `Save ${generatedDraftSummary.newDrafts.length} cards`}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="app-panel p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.25rem] border border-white/20 bg-[linear-gradient(180deg,#fff8fd,#ffdff4)] text-xl font-semibold text-[#10091d] shadow-[0_10px_20px_rgba(255,214,246,0.16)]">
                  |
                </div>
                <div className="min-w-0">
                  <div className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-text-muted">
                    Import cards
                  </div>
                  <div className="mt-1 truncate text-lg font-semibold text-white">
                    Paste a Front | Back list
                  </div>
                </div>
              </div>

              <label className="inline-flex min-h-[2.75rem] cursor-pointer items-center justify-center rounded-[2rem] border border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.07))] px-4 py-2 text-sm font-medium text-white shadow-[0_10px_20px_rgba(11,4,32,0.12)] transition duration-fast hover:-translate-y-[1px] hover:border-white/22 hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.20),rgba(255,255,255,0.09))]">
                Upload .txt, .tsv, or .csv
                <input
                  type="file"
                  accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv"
                  className="sr-only"
                  disabled={importing}
                  onChange={(event) => void handleImportFileChange(event)}
                />
              </label>
            </div>

            <div className="mt-5 space-y-4 animate-fade-in">
              <Textarea
                label="Cards to import"
                placeholder={"Front | Back\nCapital of Japan | Tokyo\nPhotosynthesis | Plants turn light into chemical energy"}
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                rows={8}
                disabled={importing}
              />

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Format
                  </div>
                  <p className="mt-2 text-sm leading-6 text-text-secondary">
                    One card per line. Use Front | Back, Front tab Back, or two CSV columns.
                  </p>
                  <p className="mt-2 text-xs leading-5 text-text-muted">
                    A first row named Front | Back or Term | Definition is skipped automatically.
                  </p>
                  {importFileName ? (
                    <p className="mt-3 text-xs font-medium text-warm-accent">
                      Loaded {importFileName}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4">
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Preview
                  </div>
                  {importSummary.cards.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {importSummary.cards.slice(0, 3).map((card, index) => (
                        <div
                          key={`${card.front}-${index}`}
                          className="rounded-[1rem] border border-white/[0.08] bg-surface-panel-strong p-3"
                        >
                          <div className="truncate text-sm font-medium text-white">
                            {card.front}
                          </div>
                          <div className="mt-1 truncate text-xs text-text-muted">
                            {card.back}
                          </div>
                        </div>
                      ))}
                      {importSummary.cards.length > 3 ? (
                        <div className="text-xs text-text-muted">
                          Plus {importSummary.cards.length - 3} more.
                        </div>
                      ) : null}
                      {importDraftSummary.duplicateCount > 0 ? (
                        <div className="rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-medium text-warm-accent">
                          {importDraftSummary.duplicateCount} duplicate{importDraftSummary.duplicateCount === 1 ? "" : "s"} will be skipped.
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-text-secondary">
                      Paste cards or upload a file to check them before import.
                    </p>
                  )}
                </div>
              </div>

              {importSummary.skippedRows > 0 ? (
                <div className="rounded-[1.25rem] border border-error-muted bg-error-muted p-4 text-sm leading-6 text-rose-100">
                  <div className="font-semibold">
                    {importSummary.skippedRows} row{importSummary.skippedRows === 1 ? "" : "s"} need attention.
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {importSummary.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={handleDownloadImportErrors}
                  >
                    Download error list
                  </Button>
                </div>
              ) : null}

              <TagInput
                tags={importTags}
                pendingTag={importPendingTag}
                availableTags={availableTags}
                onTagsChange={setImportTags}
                onPendingTagChange={setImportPendingTag}
                helperText="Apply these tags to every imported card."
                disabled={importing}
              />

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={
                    importing ||
                    !deckId ||
                    !deck ||
                    importDraftSummary.newDrafts.length === 0 ||
                    importSummary.skippedRows > 0
                  }
                  onClick={() => void handleImportCards()}
                  size="lg"
                >
                  {importing
                    ? "Importing..."
                    : importDraftSummary.newDrafts.length > 0
                      ? `Import ${importDraftSummary.newDrafts.length} cards`
                      : "Import cards"}
                </Button>
                <Button
                  type="button"
                  disabled={importing || (!importText && importTags.length === 0 && !importPendingTag)}
                  onClick={clearImportDraft}
                  variant="ghost"
                  size="lg"
                >
                  Clear
                </Button>
                <div className="text-sm text-text-muted">
                  {importProgress
                    ? `${importProgress.completed} / ${importProgress.total} imported.`
                    : importDraftSummary.newDrafts.length > 0 && importSummary.skippedRows === 0
                    ? `${importDraftSummary.newDrafts.length} cards ready.`
                    : "No cards imported yet."}
                </div>
              </div>
            </div>
          </section>
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
