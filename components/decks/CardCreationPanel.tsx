"use client";

import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardContentInput,
  type Card,
} from "@/lib/study/cards";
import type { Feedback } from "@/lib/app/feedback";
import type { Topic } from "@/lib/material/topics";
import { createCard } from "@/services/study/cards";
import type { Deck } from "@/lib/study/decks";
import { featureFlags } from "@/lib/app/feature-flags";
import TopicPicker from "@/components/topics/TopicPicker";
import CardBackEditor from "@/components/decks/CardBackEditor";
import CardBackAutocomplete from "@/components/decks/CardBackAutocomplete";
import VideoCardCreator from "@/components/decks/VideoCardCreator";
import SourceCardCreator from "@/components/decks/SourceCardCreator";
import { Button, Input, SectionHeader, StudyText } from "@/components/ui";

type CreationMode = "single" | "source" | "video";

type CardCreationPanelProps = {
  userId: string;
  decks: Deck[];
  /**
   * An empty `decks` while the page is still fetching is not the same as having
   * no decks, and telling someone with a deck to "create a deck first" is worse
   * than saying nothing for a moment.
   */
  decksLoading?: boolean;
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
      className={`rounded-md border px-3 py-2 text-sm font-medium transition duration-fast ${
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
  decksLoading = false,
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

  useEffect(() => {
    if (!fallbackDeckId) {
      return;
    }

    setSingleDeckId((current) => current || fallbackDeckId);
  }, [fallbackDeckId]);

  const deckNamesById = useMemo(
    () => Object.fromEntries(decks.map((deck) => [deck.id, deck.name])),
    [decks]
  );
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
        className="app-field w-full appearance-none rounded-2xl px-5 py-[1rem] text-sm outline-none transition duration-fast disabled:opacity-60"
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
      const card = await createCard({
        deckId: singleDeckId,
        userId,
        front,
        back,
        topicIds: singleTopicIds,
      });

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

  const handleSingleCardShortcut = (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "Enter" &&
      !addingSingleCard
    ) {
      event.preventDefault();
      void handleAddSingleCard();
    }
  };

  return (
    <section id="add-card" className="app-panel p-4 sm:p-5">
      <SectionHeader
        eyebrow="Add cards"
        title="Create a flashcard."
        action={
          <div className="flex flex-wrap gap-2">
            <ModeButton active={mode === "single"} onClick={() => setMode("single")}>Single card</ModeButton>
            <ModeButton active={mode === "source"} onClick={() => setMode("source")}>From notes or file</ModeButton>
            <ModeButton active={mode === "video"} onClick={() => setMode("video")}>From video</ModeButton>
          </div>
        }
      />

      {decks.length === 0 && !decksLoading ? (
        <p className="app-subtle-panel mt-4 rounded-lg p-4 text-sm leading-6">
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
              symbols
              placeholder="Front"
              value={singleFront}
              onChange={(event) => setSingleFront(event.target.value)}
              onKeyDown={handleSingleCardShortcut}
              maxLength={MAX_FRONT_LENGTH}
              disabled={addingSingleCard}
            />
            <CardBackEditor
              label="Back"
              placeholder="Back"
              value={singleBack}
              onChange={setSingleBack}
              onKeyDown={handleSingleCardShortcut}
              maxLength={MAX_BACK_LENGTH}
              rows={6}
              disabled={addingSingleCard}
              action={
                featureFlags.enableFlashcardAi ? (
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
                ) : null
              }
            />
          </div>

          {/*
            Card text is written as LaTeX now, both by hand and by the AI draft,
            and a textarea can only ever show the source. Without this the only
            way to find out what "$\frac{a}{b}$" becomes is to save the card and
            go and study it.
          */}
          {singleFront.trim() || singleBack.trim() ? (
            <div className="app-subtle-panel rounded-lg p-4">
              <div className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                Preview
              </div>
              <div className="mt-3 space-y-2">
                <StudyText
                  as="div"
                  text={singleFront}
                  className="whitespace-pre-wrap text-sm font-medium leading-6 text-text-primary"
                />
                {singleBack.trim() ? (
                  <StudyText
                    as="div"
                    text={singleBack}
                    className="whitespace-pre-wrap border-t border-[var(--color-border)] pt-2 text-sm leading-6 text-text-secondary"
                  />
                ) : null}
              </div>
            </div>
          ) : null}
          <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3">
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
            data-tutorial-target="create-card"
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

      {mode === "video" ? (
        <VideoCardCreator
          userId={userId}
          decks={decks}
          topics={topics}
          defaultDeckId={defaultDeckId}
          onTopicsChange={onTopicsChange}
          onCardsCreated={(cards) =>
            onCardsCreated(cards, { source: "video", selectCreated: true })
          }
          onMessage={(message, error) =>
            onFeedback({ type: error ? "error" : "success", message })
          }
        />
      ) : null}

      {mode === "source" ? (
        <SourceCardCreator
          userId={userId}
          decks={decks}
          topics={topics}
          defaultDeckId={defaultDeckId}
          onTopicsChange={onTopicsChange}
          onCardsCreated={(cards) =>
            onCardsCreated(cards, { source: "source", selectCreated: true })
          }
          onMessage={(message, error) =>
            onFeedback({ type: error ? "error" : "success", message })
          }
        />
      ) : null}

    </section>
  );
} 
