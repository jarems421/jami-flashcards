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
import { cardImageDraftFrom, type CardImageDraft } from "@/lib/study/card-images";
import {
  getCardFacesError,
  normalizeCardContentInput,
  type Card,
} from "@/lib/study/cards";
import {
  cardSaveErrorMessage,
  commitCardImageDrafts,
  deleteCardImageFiles,
  releaseCardImageDraft,
} from "@/services/study/card-images";
import { deleteCard, updateCardContent } from "@/services/study/cards";

export type CardDraft = {
  front: string;
  back: string;
  topicIds: string[];
  frontImage?: CardImageDraft;
  backImage?: CardImageDraft;
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
  /** The card open in the editor, or null. */
  card: Card | null;
  /**
   * Why the open edit could not be saved. The editor floats above the page, so
   * its own failures belong beside its fields rather than in the page banner
   * behind it.
   */
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const previewCard = useMemo(
    () => cards.find((card) => card.id === previewCardId) ?? null,
    [cards, previewCardId]
  );
  const editingCard = useMemo(
    () => cards.find((card) => card.id === rows.editingId) ?? null,
    [cards, rows.editingId]
  );

  const cancel = useCallback(() => {
    releaseCardImageDraft(rows.draft?.frontImage);
    releaseCardImageDraft(rows.draft?.backImage);
    rows.cancelEditing();
    rows.setSaving(null);
    setError(null);
  }, [rows]);

  const start = useCallback(
    (card: Card) => {
      rows.startEditing(card.id, {
        front: card.front,
        back: card.back,
        topicIds: card.topicIds ?? [],
        frontImage: cardImageDraftFrom(card.frontImage),
        backImage: cardImageDraftFrom(card.backImage),
      });
      setError(null);
      feedback.clear();
    },
    [feedback, rows]
  );

  const save = useCallback(
    async (cardId: string) => {
      const nextFront = normalizeCardContentInput(draft.front);
      const nextBack = normalizeCardContentInput(draft.back);
      const problem = getCardFacesError({
        front: nextFront,
        back: nextBack,
        hasFrontImage: Boolean(draft.frontImage),
        hasBackImage: Boolean(draft.backImage),
      });
      if (problem) {
        setError(problem);
        return;
      }
      const previous = cards.find((card) => card.id === cardId);

      rows.setSaving(cardId);
      setError(null);
      feedback.clear();
      try {
        const { frontImage, backImage } = await commitCardImageDrafts({
          userId: previous?.userId ?? "",
          drafts: { frontImage: draft.frontImage, backImage: draft.backImage },
          previous,
          write: (images) =>
            updateCardContent(cardId, {
              front: nextFront,
              back: nextBack,
              topicIds: draft.topicIds,
              ...images,
            }),
        });
        setCards((current) =>
          current.map((card) =>
            card.id === cardId
              ? {
                  ...card,
                  front: nextFront,
                  back: nextBack,
                  frontImage,
                  backImage,
                  topicIds: draft.topicIds,
                  tags: [],
                }
              : card
          )
        );
        cancel();
        feedback.success("Card updated.");
      } catch (saveError) {
        console.error("Failed to update card.", saveError);
        rows.setSaving(null);
        setError(cardSaveErrorMessage(saveError, "Failed to update card."));
      }
    },
    [cancel, cards, draft, feedback, rows, setCards]
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) return;
    const cardId = pendingDeleteId;
    rows.setDeleting(cardId);
    feedback.clear();

    try {
      const deleted = cards.find((card) => card.id === cardId);
      await deleteCard(cardId);
      if (deleted?.frontImage || deleted?.backImage) {
        await deleteCardImageFiles([deleted.frontImage, deleted.backImage]);
      }
      setCards((current) =>
        current.filter((card) => card.id !== cardId)
      );
      onCardDeleted(cardId);
      if (rows.isEditing(cardId)) cancel();
      setPendingDeleteId(null);
      feedback.success("Card deleted.");
    } catch (deleteError) {
      console.error("Failed to delete card.", deleteError);
      feedback.showError("Failed to delete card.");
    } finally {
      rows.setDeleting(null);
    }
  }, [cancel, cards, feedback, onCardDeleted, pendingDeleteId, rows, setCards]);

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
    card: editingCard,
    error,
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
