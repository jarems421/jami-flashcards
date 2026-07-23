"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  addDoc,
  collection,
  doc,
  writeBatch,
} from "firebase/firestore";
import {
  getCardContentKey,
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardContentInput,
  parseCardImportText,
  type Card,
  type ImportedCardDraft,
} from "@/lib/study/cards";
import { downloadTextFile } from "@/lib/app/download";
import type { Topic } from "@/lib/practice/topics";
import { db } from "@/services/firebase/client";
import type { Deck } from "@/services/study/decks";
import { featureFlags } from "@/lib/app/feature-flags";
import TopicPicker from "@/components/topics/TopicPicker";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import { Button, Input, SectionHeader, StudyText, Textarea } from "@/components/ui";

type CreationMode = "single" | "list";
type Feedback = { type: "success" | "error"; message: string };

type CardCreationPanelProps = {
  userId: string;
  decks: Deck[];
  existingCards: Card[];
  topics: Topic[];
  onTopicsChange: (topics: Topic[]) => void;
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
          ? "app-selected ring-1 ring-warm-accent/15"
          : "app-chip hover:border-border-strong hover:text-text-primary"
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
  topics,
  onTopicsChange,
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
  const [singleTopicIds, setSingleTopicIds] = useState<string[]>([]);
  const [addingSingleCard, setAddingSingleCard] = useState(false);

  const [listDeckId, setListDeckId] = useState(fallbackDeckId);
  const [listText, setListText] = useState("");
  const [listFileName, setListFileName] = useState("");
  const [listTopicIds, setListTopicIds] = useState<string[]>([]);
  const [addingListCards, setAddingListCards] = useState(false);
  const [listProgress, setListProgress] = useState<{ completed: number; total: number } | null>(null);

  useEffect(() => {
    if (!fallbackDeckId) {
      return;
    }

    setSingleDeckId((current) => current || fallbackDeckId);
    setListDeckId((current) => current || fallbackDeckId);
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

  const createCardsFromDrafts = async (
    drafts: ImportedCardDraft[],
    deckId: string,
    topicIds: string[] = [],
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
          const front = normalizeCardContentInput(draft.front);
          const back = normalizeCardContentInput(draft.back);
          const card: Card = {
            id: cardRef.id,
            deckId,
            userId,
            front,
            back,
            tags: [],
            topicIds,
            createdAt,
          };

          batch.set(cardRef, {
            deckId,
            userId,
            front,
            back,
            tags: [],
            topicIds,
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
        className="app-field w-full appearance-none rounded-[2rem] px-5 py-[1rem] text-sm outline-none transition duration-fast disabled:opacity-60"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238f7de8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
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
    const front = normalizeCardContentInput(singleFront);
    const back = normalizeCardContentInput(singleBack);
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

    setAddingSingleCard(true);

    try {
      const createdAt = Date.now();
      const ref = await addDoc(collection(db, "cards"), {
        deckId: singleDeckId,
        userId,
        front,
        back,
        tags: [],
        topicIds: singleTopicIds,
        createdAt,
      });
      const card: Card = {
        id: ref.id,
        deckId: singleDeckId,
        userId,
        front,
        back,
        tags: [],
        topicIds: singleTopicIds,
        createdAt,
      };

      setSingleFront("");
      setSingleBack("");
      setSingleTopicIds([]);
      onCardsCreated([card], { source: "single", selectCreated: false });
      onFeedback({
        type: "success",
        message: "Card added. Review it in Learn when it becomes due.",
      });
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
        listTopicIds,
        (completed, total) => setListProgress({ completed, total })
      );
      const duplicateMessage =
        listDraftSummary.duplicateCount > 0
          ? ` Skipped ${listDraftSummary.duplicateCount} duplicate${listDraftSummary.duplicateCount === 1 ? "" : "s"}.`
          : "";

      setListText("");
      setListFileName("");
      setListTopicIds([]);
      setListProgress(null);
      onCardsCreated(createdCards, { source: "list", selectCreated: true });
      onFeedback({
        type: "success",
        message: `Added ${createdCards.length} cards.${duplicateMessage} They are selected below so you can add Topics if needed.`,
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

  return (
    <section
      id="add-card"
      className="app-panel p-4 sm:p-5"
      onKeyDown={(event) => {
        if (
          mode === "single" &&
          (event.ctrlKey || event.metaKey) &&
          event.key === "Enter" &&
          !addingSingleCard
        ) {
          event.preventDefault();
          void handleAddSingleCard();
        }
      }}
    >
      <SectionHeader
        eyebrow="Add cards"
        title="Create a flashcard."
        action={
          <div className="flex flex-wrap gap-2">
            <ModeButton active={mode === "single"} onClick={() => setMode("single")}>Single card</ModeButton>
            <ModeButton active={mode === "list"} onClick={() => setMode("list")}>Advanced: Paste list</ModeButton>
          </div>
        }
      />

      {decks.length === 0 ? (
        <p className="app-subtle-panel mt-4 rounded-[1.25rem] p-4 text-sm leading-6">
          Create a deck first. Then you can add cards here.
        </p>
      ) : null}

      {mode === "single" ? (
        <div className="mt-5 space-y-4 animate-fade-in">
          {!deckIsFixed ? (
            <div>
              <div className="mb-2 text-sm font-medium tracking-[0.01em] text-text-secondary">
                Deck
              </div>
              {renderDeckSelect(singleDeckId, setSingleDeckId, addingSingleCard)}
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <Input
              label="Front"
              placeholder="Front"
              value={singleFront}
              onChange={(event) => setSingleFront(event.target.value)}
              maxLength={MAX_FRONT_LENGTH}
              disabled={addingSingleCard}
            />
            <div className="space-y-3">
              <CardBackEditor
                label="Back"
                placeholder="Back"
                value={singleBack}
                onChange={setSingleBack}
                maxLength={MAX_BACK_LENGTH}
                rows={6}
                disabled={addingSingleCard}
              />
              {featureFlags.enableFlashcardAi ? (
                <CardBackAutocomplete
                  front={singleFront}
                  currentBack={singleBack}
                  deckId={singleDeckId || undefined}
                  deckName={deckNamesById[singleDeckId]}
                  topics={topics
                    .filter((topic) => singleTopicIds.includes(topic.id))
                    .map((topic) => topic.name)}
                  topicIds={singleTopicIds}
                  disabled={addingSingleCard}
                  onApply={setSingleBack}
                />
              ) : null}
            </div>
          </div>
          <details className="rounded-[1.15rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-text-secondary">
              Topics <span className="font-normal text-text-muted">(optional)</span>
            </summary>
            <div className="mt-4">
              <TopicPicker
                userId={userId}
                topics={topics}
                selectedTopicIds={singleTopicIds}
                onChange={setSingleTopicIds}
                onTopicsChange={onTopicsChange}
                disabled={addingSingleCard}
              />
            </div>
          </details>
          <Button
            type="button"
            aria-keyshortcuts="Control+Enter Meta+Enter"
            disabled={addingSingleCard || !singleDeckId || !singleFront.trim() || !singleBack.trim()}
            onClick={() => void handleAddSingleCard()}
            size="lg"
            className="w-full sm:w-auto"
          >
            {addingSingleCard ? "Adding..." : "Add card"}
          </Button>
        </div>
      ) : null}

      {mode === "list" ? (
        <div className="mt-5 space-y-4 animate-fade-in">
          {!deckIsFixed ? (
            <div>
              <div className="mb-2 text-sm font-medium tracking-[0.01em] text-text-secondary">
                Deck
              </div>
              {renderDeckSelect(listDeckId, setListDeckId, addingListCards)}
            </div>
          ) : null}
          <Textarea
            label="Cards to add"
            placeholder={"Front | Back\nFront - Back\n\nFront\nBack"}
            value={listText}
            onChange={(event) => setListText(event.target.value)}
            rows={8}
            disabled={addingListCards}
          />
          <details className="rounded-[1.15rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-text-secondary">
              Topics for imported cards{" "}
              <span className="font-normal text-text-muted">(optional)</span>
            </summary>
            <div className="mt-4">
              <TopicPicker
                userId={userId}
                topics={topics}
                selectedTopicIds={listTopicIds}
                onChange={setListTopicIds}
                onTopicsChange={onTopicsChange}
                disabled={addingListCards}
              />
            </div>
          </details>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="app-subtle-panel rounded-[1.25rem] p-4">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Formats
              </div>
              <div className="mt-2 space-y-2 text-sm leading-6 text-text-secondary">
                <p className="app-chip rounded-[1rem] px-3 py-2 font-mono text-xs">
                  Front | Back
                </p>
                <p>Dash, colon, or two-line cards also work.</p>
              </div>
              <label className="app-chip mt-3 inline-flex min-h-[2.5rem] cursor-pointer items-center justify-center rounded-[1.4rem] px-3 py-2 text-sm font-medium transition duration-fast hover:border-border-strong">
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
                <p className="mt-3 text-xs font-medium text-text-secondary">
                  Loaded {listFileName}
                </p>
              ) : null}
            </div>

            <div className="app-subtle-panel rounded-[1.25rem] p-4">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Preview
              </div>
              {listSummary.cards.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {listSummary.cards.slice(0, 3).map((card, index) => (
                    <div
                      key={`${card.front}-${index}`}
                      className="app-subtle-panel rounded-[1rem] p-3"
                    >
                      <StudyText
                        as="div"
                        text={card.front}
                        className="truncate text-sm font-medium text-text-primary"
                      />
                      <StudyText
                        as="div"
                        text={card.back}
                        className="mt-1 truncate text-xs text-text-muted"
                      />
                    </div>
                  ))}
                  {listSummary.cards.length > 3 ? (
                    <div className="text-xs text-text-muted">
                      Plus {listSummary.cards.length - 3} more.
                    </div>
                  ) : null}
                  {listDraftSummary.duplicateCount > 0 ? (
                    <div className="app-selected rounded-full px-3 py-1.5 text-xs font-medium">
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
            <div className="rounded-[1.25rem] border border-error/35 bg-error-muted p-4 text-sm leading-6 text-[var(--color-error-text)]">
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

          <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
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
              className="w-full sm:w-auto"
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
                setListTopicIds([]);
                setListProgress(null);
              }}
              variant="ghost"
              size="lg"
              className="w-full sm:w-auto"
            >
              Clear
            </Button>
            <div className="text-center text-sm text-text-muted sm:text-left">
              {listProgress
                ? `${listProgress.completed} / ${listProgress.total} added.`
                : listDraftSummary.newDrafts.length > 0 && listSummary.skippedRows === 0
                  ? `${listDraftSummary.newDrafts.length} cards ready.`
                  : "No cards added yet."}
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
} 
