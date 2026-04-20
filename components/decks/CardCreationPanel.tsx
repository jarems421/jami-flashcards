"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  addDoc,
  collection,
  doc,
  writeBatch,
} from "firebase/firestore";
import {
  addCardTag,
  getCardContentKey,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
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
import { db } from "@/services/firebase/client";
import type { Deck } from "@/services/study/decks";
import TagInput from "@/components/decks/TagInput";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import { Button, Input, SectionHeader, Textarea } from "@/components/ui";

type CreationMode = "single" | "list" | "notes";
type GeneratedReviewCard = GeneratedCardDraft & { selected: boolean };
type Feedback = { type: "success" | "error"; message: string };

type CardCreationPanelProps = {
  userId: string;
  decks: Deck[];
  existingCards: Card[];
  availableTags: string[];
  defaultDeckId?: string;
  onCardsCreated: (
    cards: Card[],
    meta: { source: CreationMode; selectCreated: boolean }
  ) => void;
  onFeedback: (feedback: Feedback) => void;
};

const CARD_CREATE_BATCH_SIZE = 450;

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

function downloadTextFile(fileName: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[1rem] border px-3 py-2 text-sm font-medium transition duration-fast ${
        active
          ? "border-warm-accent/35 bg-white/[0.08] text-white ring-1 ring-warm-accent/15"
          : "border-white/[0.08] bg-white/[0.035] text-text-secondary hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export default function CardCreationPanel({
  userId,
  decks,
  existingCards,
  availableTags,
  defaultDeckId,
  onCardsCreated,
  onFeedback,
}: CardCreationPanelProps) {
  const [mode, setMode] = useState<CreationMode>("single");
  const fallbackDeckId = defaultDeckId ?? decks[0]?.id ?? "";
  const deckIsFixed = Boolean(defaultDeckId);

  const [singleDeckId, setSingleDeckId] = useState(fallbackDeckId);
  const [singleFront, setSingleFront] = useState("");
  const [singleBack, setSingleBack] = useState("");
  const [singleTags, setSingleTags] = useState<string[]>([]);
  const [singlePendingTag, setSinglePendingTag] = useState("");
  const [addingSingleCard, setAddingSingleCard] = useState(false);

  const [listDeckId, setListDeckId] = useState(fallbackDeckId);
  const [listText, setListText] = useState("");
  const [listFileName, setListFileName] = useState("");
  const [addingListCards, setAddingListCards] = useState(false);
  const [listProgress, setListProgress] = useState<{ completed: number; total: number } | null>(null);

  const [notesDeckId, setNotesDeckId] = useState(fallbackDeckId);
  const [notesText, setNotesText] = useState("");
  const [notesFileName, setNotesFileName] = useState("");
  const [generatingCards, setGeneratingCards] = useState(false);
  const [savingGeneratedCards, setSavingGeneratedCards] = useState(false);
  const [generatedCards, setGeneratedCards] = useState<GeneratedReviewCard[]>([]);

  useEffect(() => {
    if (!fallbackDeckId) {
      return;
    }

    setSingleDeckId((current) => current || fallbackDeckId);
    setListDeckId((current) => current || fallbackDeckId);
    setNotesDeckId((current) => current || fallbackDeckId);
  }, [fallbackDeckId]);

  const deckNamesById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.name])),
    [decks]
  );
  const existingKeysByDeckId = useMemo(() => {
    const keys = new Map<string, Set<string>>();

    for (const card of existingCards) {
      const deckKeys = keys.get(card.deckId) ?? new Set<string>();
      deckKeys.add(getCardContentKey(card.front, card.back));
      keys.set(card.deckId, deckKeys);
    }

    return keys;
  }, [existingCards]);

  const listSummary = useMemo(() => parseCardImportText(listText), [listText]);
  const listDraftSummary = useMemo(
    () => getNewDraftSummary(listSummary.cards, existingKeysByDeckId.get(listDeckId) ?? new Set()),
    [existingKeysByDeckId, listDeckId, listSummary.cards]
  );
  const selectedGeneratedCards = useMemo(
    () =>
      generatedCards
        .filter((card) => card.selected)
        .map(({ front, back }) => ({ front: front.trim(), back: back.trim() }))
        .filter((card) => card.front && card.back),
    [generatedCards]
  );
  const generatedDraftSummary = useMemo(
    () => getNewDraftSummary(selectedGeneratedCards, existingKeysByDeckId.get(notesDeckId) ?? new Set()),
    [existingKeysByDeckId, notesDeckId, selectedGeneratedCards]
  );

  const createCardsFromDrafts = async (
    drafts: ImportedCardDraft[],
    deckId: string,
    tags: string[] = [],
    onProgress?: (completed: number, total: number) => void
  ) => {
    const createdCards: Card[] = [];
    const createdAtBase = Date.now();
    const cardsCollection = collection(db, "cards");

    try {
      for (let start = 0; start < drafts.length; start += CARD_CREATE_BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = drafts.slice(start, start + CARD_CREATE_BATCH_SIZE);
        const chunkCards: Card[] = [];

        chunk.forEach((draft, index) => {
          const cardIndex = start + index;
          const cardRef = doc(cardsCollection);
          const createdAt = createdAtBase - cardIndex;
          const card: Card = {
            id: cardRef.id,
            deckId,
            userId,
            front: draft.front,
            back: draft.back,
            tags,
            createdAt,
          };

          batch.set(cardRef, {
            deckId,
            userId,
            front: card.front,
            back: card.back,
            tags,
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
      const nextError = error instanceof Error ? error : new Error("Failed to create cards.");
      (nextError as Error & { createdCards?: Card[] }).createdCards = createdCards;
      throw nextError;
    }
  };

  const renderDeckSelect = (
    value: string,
    onChange: (value: string) => void,
    disabled: boolean
  ) => {
    if (deckIsFixed) {
      return null;
    }

    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full appearance-none rounded-[2rem] border-[1.5px] border-white/[0.14] bg-surface-panel-strong px-5 py-[1rem] text-sm text-white outline-none transition duration-fast hover:border-white/[0.20] focus:border-warm-accent focus:ring-4 focus:ring-accent/18 disabled:opacity-60"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 1rem center",
          paddingRight: "2.5rem",
        }}
      >
        <option value="" disabled>Choose a deck</option>
        {decks.map((deck) => (
          <option key={deck.id} value={deck.id}>{deck.name}</option>
        ))}
      </select>
    );
  };

  const handleAddSingleCard = async () => {
    const front = singleFront.trim();
    const back = singleBack.trim();
    const tagResult = addCardTag(singleTags, singlePendingTag);

    if (!singleDeckId) {
      onFeedback({ type: "error", message: "Choose a deck first." });
      return;
    }

    if (!front || !back) {
      onFeedback({ type: "error", message: "Both front and back are required." });
      return;
    }

    if (front.length > MAX_FRONT_LENGTH || back.length > MAX_BACK_LENGTH) {
      onFeedback({
        type: "error",
        message: `Cards must stay under ${MAX_FRONT_LENGTH} characters on the front and ${MAX_BACK_LENGTH} on the back.`,
      });
      return;
    }

    if (tagResult.error) {
      onFeedback({ type: "error", message: tagResult.error });
      return;
    }

    setAddingSingleCard(true);
    const tags = tagResult.nextTags;

    try {
      const createdAt = Date.now();
      const ref = await addDoc(collection(db, "cards"), {
        deckId: singleDeckId,
        userId,
        front,
        back,
        tags,
        createdAt,
      });
      const card: Card = {
        id: ref.id,
        deckId: singleDeckId,
        userId,
        front,
        back,
        tags,
        createdAt,
      };

      setSingleFront("");
      setSingleBack("");
      setSingleTags([]);
      setSinglePendingTag("");
      onCardsCreated([card], { source: "single", selectCreated: false });
      onFeedback({ type: "success", message: "Card added." });
    } catch (error) {
      console.error(error);
      onFeedback({ type: "error", message: "Failed to add card." });
    } finally {
      setAddingSingleCard(false);
    }
  };

  const handleListFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    try {
      setListText(await file.text());
      setListFileName(file.name);
      onFeedback({ type: "success", message: "File loaded. Check the preview before adding cards." });
    } catch (error) {
      console.error(error);
      onFeedback({ type: "error", message: "Failed to read that file." });
    } finally {
      input.value = "";
    }
  };

  const handleAddListCards = async () => {
    if (!listDeckId) {
      onFeedback({ type: "error", message: "Choose a deck first." });
      return;
    }

    if (listSummary.skippedRows > 0) {
      onFeedback({ type: "error", message: "Fix the rows that need attention before adding cards." });
      return;
    }

    if (listDraftSummary.newDrafts.length === 0) {
      onFeedback({
        type: "error",
        message: listSummary.cards.length > 0 ? "All detected cards already exist in this deck." : "Paste a list of cards first.",
      });
      return;
    }

    setAddingListCards(true);
    setListProgress({ completed: 0, total: listDraftSummary.newDrafts.length });

    try {
      const createdCards = await createCardsFromDrafts(
        listDraftSummary.newDrafts,
        listDeckId,
        [],
        (completed, total) => setListProgress({ completed, total })
      );
      const duplicateMessage =
        listDraftSummary.duplicateCount > 0
          ? ` Skipped ${listDraftSummary.duplicateCount} duplicate${listDraftSummary.duplicateCount === 1 ? "" : "s"}.`
          : "";

      setListText("");
      setListFileName("");
      setListProgress(null);
      onCardsCreated(createdCards, { source: "list", selectCreated: true });
      onFeedback({
        type: "success",
        message: `Added ${createdCards.length} cards.${duplicateMessage} They are selected below so you can tag them if needed.`,
      });
    } catch (error) {
      console.error(error);
      const createdCards =
        error instanceof Error
          ? ((error as Error & { createdCards?: Card[] }).createdCards ?? [])
          : [];
      if (createdCards.length > 0) {
        onCardsCreated(createdCards, { source: "list", selectCreated: true });
      }
      onFeedback({
        type: "error",
        message:
          createdCards.length > 0
            ? `Added ${createdCards.length} cards before the batch stopped. Check the selected cards before retrying.`
            : "Failed to add those cards.",
      });
    } finally {
      setAddingListCards(false);
    }
  };

  const handleGenerateCards = async () => {
    if (!notesDeckId) {
      onFeedback({ type: "error", message: "Choose a deck first." });
      return;
    }

    if (notesText.trim().length < MIN_NOTES_FOR_CARD_GENERATION) {
      onFeedback({
        type: "error",
        message: `Paste at least ${MIN_NOTES_FOR_CARD_GENERATION} characters of notes before generating cards.`,
      });
      return;
    }

    setGeneratingCards(true);

    try {
      const drafts = await generateCardsFromNotes({
        notes: notesText,
        deckName: deckNamesById[notesDeckId],
      });
      setGeneratedCards(drafts.map((draft) => ({ ...draft, selected: true })));
      onFeedback({
        type: "success",
        message: `Generated ${drafts.length} draft cards. Review them before saving.`,
      });
    } catch (error) {
      console.error(error);
      onFeedback({
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

  const handleNotesFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const trimmedText = text.trim();
      if (!trimmedText) {
        onFeedback({ type: "error", message: "That file did not contain readable notes." });
        return;
      }

      const limitedText = trimmedText.slice(0, MAX_NOTES_FOR_CARD_GENERATION);
      setNotesText(limitedText);
      setNotesFileName(file.name);
      onFeedback({
        type: "success",
        message:
          trimmedText.length > MAX_NOTES_FOR_CARD_GENERATION
            ? `Loaded the first ${MAX_NOTES_FOR_CARD_GENERATION.toLocaleString()} characters from ${file.name}.`
            : `Loaded notes from ${file.name}.`,
      });
    } catch (error) {
      console.error(error);
      onFeedback({ type: "error", message: "Failed to read that notes file." });
    } finally {
      input.value = "";
    }
  };

  const updateGeneratedCard = (
    index: number,
    field: "front" | "back" | "selected",
    value: string | boolean
  ) => {
    setGeneratedCards((currentCards) =>
      currentCards.map((card, cardIndex) =>
        cardIndex === index ? { ...card, [field]: value } : card
      )
    );
  };

  const handleSaveGeneratedCards = async () => {
    if (!notesDeckId) {
      onFeedback({ type: "error", message: "Choose a deck first." });
      return;
    }

    if (selectedGeneratedCards.length === 0) {
      onFeedback({ type: "error", message: "Select at least one generated card to save." });
      return;
    }

    if (generatedDraftSummary.newDrafts.length === 0) {
      onFeedback({ type: "error", message: "The selected generated cards already exist in this deck." });
      return;
    }

    setSavingGeneratedCards(true);

    try {
      const createdCards = await createCardsFromDrafts(
        generatedDraftSummary.newDrafts,
        notesDeckId
      );
      const duplicateMessage =
        generatedDraftSummary.duplicateCount > 0
          ? ` Skipped ${generatedDraftSummary.duplicateCount} duplicate${generatedDraftSummary.duplicateCount === 1 ? "" : "s"}.`
          : "";

      setNotesText("");
      setGeneratedCards([]);
      onCardsCreated(createdCards, { source: "notes", selectCreated: true });
      onFeedback({
        type: "success",
        message: `Saved ${createdCards.length} generated cards.${duplicateMessage} They are selected below so you can tag them if needed.`,
      });
    } catch (error) {
      console.error(error);
      const createdCards =
        error instanceof Error
          ? ((error as Error & { createdCards?: Card[] }).createdCards ?? [])
          : [];
      if (createdCards.length > 0) {
        onCardsCreated(createdCards, { source: "notes", selectCreated: true });
      }
      onFeedback({
        type: "error",
        message:
          createdCards.length > 0
            ? `Saved ${createdCards.length} cards before the batch stopped. Check the selected cards before retrying.`
            : "Failed to save generated cards.",
      });
    } finally {
      setSavingGeneratedCards(false);
    }
  };

  return (
    <section className="app-panel p-4 sm:p-5">
      <SectionHeader
        eyebrow="Add cards"
        title="Add one card or bring in a batch."
        description="Start small, paste a list, or turn notes into drafts. Tags can be added to selected cards after a batch is saved."
        action={
          <div className="flex flex-wrap gap-2">
            <ModeButton active={mode === "single"} onClick={() => setMode("single")}>One card</ModeButton>
            <ModeButton active={mode === "list"} onClick={() => setMode("list")}>Paste a list</ModeButton>
            <ModeButton active={mode === "notes"} onClick={() => setMode("notes")}>Use notes</ModeButton>
          </div>
        }
      />

      {decks.length === 0 ? (
        <p className="mt-4 rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
          Create a deck first, then cards can be added here.
        </p>
      ) : null}

      {mode === "single" ? (
        <div className="mt-5 space-y-4 animate-fade-in">
          {renderDeckSelect(singleDeckId, setSingleDeckId, addingSingleCard)}
          <div className="grid gap-4 lg:grid-cols-2">
            <Input
              label="Front"
              placeholder="Question, prompt, or cue"
              value={singleFront}
              onChange={(event) => setSingleFront(event.target.value)}
              maxLength={MAX_FRONT_LENGTH}
              disabled={addingSingleCard}
            />
            <div className="space-y-3">
              <CardBackEditor
                label="Back"
                placeholder="Answer or explanation"
                value={singleBack}
                onChange={setSingleBack}
                maxLength={MAX_BACK_LENGTH}
                rows={6}
                disabled={addingSingleCard}
              />
              <CardBackAutocomplete
                front={singleFront}
                currentBack={singleBack}
                deckId={singleDeckId || undefined}
                deckName={deckNamesById[singleDeckId]}
                tags={singleTags}
                disabled={addingSingleCard}
                onApply={setSingleBack}
              />
            </div>
          </div>
          <TagInput
            tags={singleTags}
            pendingTag={singlePendingTag}
            availableTags={availableTags}
            onTagsChange={setSingleTags}
            onPendingTagChange={setSinglePendingTag}
            helperText="For batches, save the cards first, then select the ones that need the same tag."
            disabled={addingSingleCard}
          />
          <Button
            type="button"
            disabled={addingSingleCard || !singleDeckId || !singleFront.trim() || !singleBack.trim()}
            onClick={() => void handleAddSingleCard()}
            size="lg"
          >
            {addingSingleCard ? "Adding..." : "Add card"}
          </Button>
        </div>
      ) : null}

      {mode === "list" ? (
        <div className="mt-5 space-y-4 animate-fade-in">
          {renderDeckSelect(listDeckId, setListDeckId, addingListCards)}
          <Textarea
            label="Cards to add"
            placeholder={"Capital of Japan | Tokyo\nPhotosynthesis - Plants turn light into chemical energy\nMitosis: Cell division that creates two identical cells\n\nOsmosis\nWater moving through a membrane"}
            value={listText}
            onChange={(event) => setListText(event.target.value)}
            rows={8}
            disabled={addingListCards}
          />

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Accepted formats
              </div>
              <div className="mt-2 space-y-2 text-sm leading-6 text-text-secondary">
                <p>One card per line:</p>
                <p className="rounded-[1rem] border border-white/[0.08] bg-black/10 px-3 py-2 font-mono text-xs text-text-secondary">
                  Question | Answer
                </p>
                <p>
                  A dash or colon also works: Question - Answer or Question: Answer.
                </p>
                <p>
                  You can also put the question on one line and the answer on the next. Leave a blank line before the next card.
                </p>
              </div>
              <p className="mt-2 text-xs leading-5 text-text-muted">
                Spreadsheet and flashcard app files work too when the first column is the question and the second is the answer.
              </p>
              <label className="mt-3 inline-flex min-h-[2.5rem] cursor-pointer items-center justify-center rounded-[1.4rem] border border-white/14 bg-white/[0.05] px-3 py-2 text-sm font-medium text-white transition duration-fast hover:border-white/22 hover:bg-white/[0.08]">
                Upload a file
                <input
                  type="file"
                  accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv"
                  className="sr-only"
                  disabled={addingListCards}
                  onChange={(event) => void handleListFileChange(event)}
                />
              </label>
              {listFileName ? (
                <p className="mt-3 text-xs font-medium text-warm-accent">
                  Loaded {listFileName}
                </p>
              ) : null}
            </div>

            <div className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Preview
              </div>
              {listSummary.cards.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {listSummary.cards.slice(0, 3).map((card, index) => (
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
                  {listSummary.cards.length > 3 ? (
                    <div className="text-xs text-text-muted">
                      Plus {listSummary.cards.length - 3} more.
                    </div>
                  ) : null}
                  {listDraftSummary.duplicateCount > 0 ? (
                    <div className="rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-medium text-warm-accent">
                      {listDraftSummary.duplicateCount} duplicate{listDraftSummary.duplicateCount === 1 ? "" : "s"} will be skipped.
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-sm leading-6 text-text-secondary">
                  Paste cards or upload a file to check them before saving.
                </p>
              )}
            </div>
          </div>

          {listSummary.skippedRows > 0 ? (
            <div className="rounded-[1.25rem] border border-error-muted bg-error-muted p-4 text-sm leading-6 text-rose-100">
              <div className="font-semibold">
                {listSummary.skippedRows} row{listSummary.skippedRows === 1 ? "" : "s"} need attention.
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {listSummary.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => downloadTextFile("card-list-issues.txt", listSummary.errors.join("\n"))}
              >
                Save issues
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={
                addingListCards ||
                !listDeckId ||
                listDraftSummary.newDrafts.length === 0 ||
                listSummary.skippedRows > 0
              }
              onClick={() => void handleAddListCards()}
              size="lg"
            >
              {addingListCards
                ? "Adding..."
                : listDraftSummary.newDrafts.length > 0
                  ? `Add ${listDraftSummary.newDrafts.length} cards`
                  : "Add cards"}
            </Button>
            <Button
              type="button"
              disabled={addingListCards || (!listText && !listFileName)}
              onClick={() => {
                setListText("");
                setListFileName("");
                setListProgress(null);
              }}
              variant="ghost"
              size="lg"
            >
              Clear
            </Button>
            <div className="text-sm text-text-muted">
              {listProgress
                ? `${listProgress.completed} / ${listProgress.total} added.`
                : listDraftSummary.newDrafts.length > 0 && listSummary.skippedRows === 0
                  ? `${listDraftSummary.newDrafts.length} cards ready.`
                  : "No cards added yet."}
            </div>
          </div>
        </div>
      ) : null}

      {mode === "notes" ? (
        <div className="mt-5 space-y-4 animate-fade-in">
          {renderDeckSelect(notesDeckId, setNotesDeckId, generatingCards || savingGeneratedCards)}
          <Textarea
            label="Notes"
            placeholder="Paste class notes, a textbook summary, or revision bullet points..."
            value={notesText}
            onChange={(event) => setNotesText(event.target.value.slice(0, MAX_NOTES_FOR_CARD_GENERATION))}
            rows={8}
            disabled={generatingCards || savingGeneratedCards}
          />
          <div className="rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                  Notes upload
                </div>
                <p className="mt-2 text-sm leading-6 text-text-secondary">
                  Upload plain text or markdown notes, or paste them above. No special format is needed for notes.
                </p>
                <p className="mt-2 text-xs leading-5 text-text-muted">
                  For now, copy text out of PDF or Word files before adding it here.
                </p>
                {notesFileName ? (
                  <p className="mt-3 text-xs font-medium text-warm-accent">
                    Loaded {notesFileName}
                  </p>
                ) : null}
              </div>
              <label className="inline-flex min-h-[2.5rem] cursor-pointer items-center justify-center rounded-[1.4rem] border border-white/14 bg-white/[0.05] px-3 py-2 text-sm font-medium text-white transition duration-fast hover:border-white/22 hover:bg-white/[0.08]">
                Upload notes
                <input
                  type="file"
                  accept=".txt,.md,.markdown,text/plain,text/markdown,text/x-markdown"
                  className="sr-only"
                  disabled={generatingCards || savingGeneratedCards}
                  onChange={(event) => void handleNotesFileChange(event)}
                />
              </label>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
            <span>
              {notesText.trim().length.toLocaleString()} / {MAX_NOTES_FOR_CARD_GENERATION.toLocaleString()} characters
            </span>
            <span>
              Minimum {MIN_NOTES_FOR_CARD_GENERATION} characters.
            </span>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={generatingCards || savingGeneratedCards || !notesDeckId || notesText.trim().length < MIN_NOTES_FOR_CARD_GENERATION}
              onClick={() => void handleGenerateCards()}
              size="lg"
            >
              {generatingCards ? "Generating..." : "Generate drafts"}
            </Button>
            <Button
              type="button"
              disabled={generatingCards || savingGeneratedCards || (!notesText && generatedCards.length === 0)}
              onClick={() => {
                setNotesText("");
                setNotesFileName("");
                setGeneratedCards([]);
              }}
              variant="ghost"
              size="lg"
            >
              Clear
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

              <Button
                type="button"
                disabled={savingGeneratedCards || generatedDraftSummary.newDrafts.length === 0}
                onClick={() => void handleSaveGeneratedCards()}
                size="lg"
              >
                {savingGeneratedCards ? "Saving..." : `Save ${generatedDraftSummary.newDrafts.length} cards`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
