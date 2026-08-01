"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  type InlineRowEditing,
  useInlineRowEditing,
} from "@/hooks/useInlineRowEditing";
import {
  MAX_BACK_LENGTH,
  MAX_FRONT_LENGTH,
  normalizeCardContentInput,
  type Card,
} from "@/lib/study/cards";
import { deleteCard, updateCardContent } from "@/services/study/cards";

export type CardDraft = {
  front: string;
  back: string;
  topicIds: string[];
};

const EMPTY_CARD_DRAFT: CardDraft = {
  front: "",
  back: "",
  topicIds: [],
};

type CardEditingFeedback = {
  clear: () => void;
  showError: (message: string) => void;
  success: (message: string) => void;
};

type UseCardEditingOptions = {
  cards: Card[];
  setCards: Dispatch<SetStateAction<Card[]>>;
  onCardDeleted: (cardId: string) => void;
  feedback: CardEditingFeedback;
};

export type CardEditingController = {
  rows: InlineRowEditing<CardDraft>;
  draft: CardDraft;
  start: (card: Card) => void;
  cancel: () => void;
  save: (cardId: string) => Promise<void>;
  deletion: {
    pendingCardId: string | null;
    request: (cardId: string) => void;
    close: () => void;
    confirm: () => Promise<void>;
  };
  preview: {
    card: Card | null;
    open: (cardId: string) => void;
    close: () => void;
    edit: (card: Card) => void;
  };
};

/** Owns the lifecycle for one edited, deleted, or previewed card at a time. */
export function useCardEditing({
  cards,
  setCards,
  onCardDeleted,
  feedback,
}: UseCardEditingOptions): CardEditingController {
  const rows = useInlineRowEditing<CardDraft>();
  const draft = rows.draft ?? EMPTY_CARD_DRAFT;
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const previewCard = useMemo(
    () => cards.find((card) => card.id === previewCardId) ?? null,
    [cards, previewCardId]
  );

  const cancel = useCallback(() => {
    rows.cancelEditing();
    rows.setSaving(null);
  }, [rows]);

  const start = useCallback(
    (card: Card) => {
      rows.startEditing(card.id, {
        front: card.front,
        back: card.back,
        topicIds: card.topicIds ?? [],
      });
      feedback.clear();
    },
    [feedback, rows]
  );

  const save = useCallback(
    async (cardId: string) => {
      const nextFront = normalizeCardContentInput(draft.front);
      const nextBack = normalizeCardContentInput(draft.back);

      if (!nextFront || !nextBack) {
        feedback.showError("Both front and back are required.");
        return;
      }
      if (
        nextFront.length > MAX_FRONT_LENGTH ||
        nextBack.length > MAX_BACK_LENGTH
      ) {
        feedback.showError(
          `Cards must stay under ${MAX_FRONT_LENGTH} characters on the front and ${MAX_BACK_LENGTH} on the back.`
        );
        return;
      }

      rows.setSaving(cardId);
      feedback.clear();
      try {
        await updateCardContent(cardId, {
          front: nextFront,
          back: nextBack,
          topicIds: draft.topicIds,
        });
        setCards((current) =>
          current.map((card) =>
            card.id === cardId
              ? {
                  ...card,
                  front: nextFront,
                  back: nextBack,
                  topicIds: draft.topicIds,
                  tags: [],
                }
              : card
          )
        );
        cancel();
        feedback.success("Card updated.");
      } catch (error) {
        console.error("Failed to update card.", error);
        rows.setSaving(null);
        feedback.showError("Failed to update card.");
      }
    },
    [cancel, draft, feedback, rows, setCards]
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    const cardId = pendingDeleteId;
    rows.setDeleting(cardId);
    feedback.clear();

    try {
      await deleteCard(cardId);
      setCards((current) =>
        current.filter((card) => card.id !== cardId)
      );
      onCardDeleted(cardId);
      if (rows.isEditing(cardId)) cancel();
      setPendingDeleteId(null);
      feedback.success("Card deleted.");
    } catch (error) {
      console.error("Failed to delete card.", error);
      feedback.showError("Failed to delete card.");
    } finally {
      rows.setDeleting(null);
    }
  }, [cancel, feedback, onCardDeleted, pendingDeleteId, rows, setCards]);

  const editPreview = useCallback(
    (card: Card) => {
      setPreviewCardId(null);
      start(card);
    },
    [start]
  );

  return {
    rows,
    draft,
    start,
    cancel,
    save,
    deletion: {
      pendingCardId: pendingDeleteId,
      request: setPendingDeleteId,
      close: () => setPendingDeleteId(null),
      confirm: confirmDelete,
    },
    preview: {
      card: previewCard,
      open: setPreviewCardId,
      close: () => setPreviewCardId(null),
      edit: editPreview,
    },
  };
}
