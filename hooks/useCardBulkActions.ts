"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useMultiSelect } from "@/hooks/useMultiSelect";
import { getBulkTopicCapacity } from "@/lib/material/topic-management";
import { MAX_LINKED_TOPICS } from "@/lib/material/topics";
import type { Card } from "@/lib/study/cards";
import {
  deleteCards,
  moveCardsToDeck,
  setCardTopicsInBulk,
} from "@/services/study/cards";

type CardBulkFeedback = {
  clear: () => void;
  showError: (message: string) => void;
  success: (message: string) => void;
};

type UseCardBulkActionsOptions = {
  cards: Card[];
  setCards: Dispatch<SetStateAction<Card[]>>;
  visibleCardIds: string[];
  selectedCardIds: string[];
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  topicSelectionResetKey: number;
  feedback: CardBulkFeedback;
};

export type CardBulkActionsController = {
  selection: {
    ids: string[];
    idSet: Set<string>;
    selectVisible: () => void;
    clear: () => void;
    remove: (cardId: string) => void;
    handleCheckboxClick: ReturnType<
      typeof useMultiSelect
    >["handleCheckboxClick"];
  };
  topics: {
    ids: string[];
    setIds: Dispatch<SetStateAction<string[]>>;
    capacity: number;
    applying: boolean;
    apply: () => Promise<void>;
  };
  move: {
    deckId: string;
    setDeckId: Dispatch<SetStateAction<string>>;
    applying: boolean;
    apply: () => Promise<void>;
  };
  deletion: {
    pending: boolean;
    setPending: Dispatch<SetStateAction<boolean>>;
    applying: boolean;
    confirm: () => Promise<void>;
  };
  actionInFlight: boolean;
};

/** Owns selection and all multi-card mutations for the browser. */
export function useCardBulkActions({
  cards,
  setCards,
  visibleCardIds,
  selectedCardIds,
  setSelectedCardIds,
  topicSelectionResetKey,
  feedback,
}: UseCardBulkActionsOptions): CardBulkActionsController {
  const [bulkTopicSelection, setBulkTopicSelection] = useState({
    key: topicSelectionResetKey,
    ids: [] as string[],
  });
  const bulkTopicIds = useMemo(
    () =>
      bulkTopicSelection.key === topicSelectionResetKey
        ? bulkTopicSelection.ids
        : [],
    [bulkTopicSelection, topicSelectionResetKey]
  );
  const setBulkTopicIds = useCallback<Dispatch<SetStateAction<string[]>>>(
    (action) => {
      setBulkTopicSelection((current) => {
        const currentIds =
          current.key === topicSelectionResetKey ? current.ids : [];
        const nextIds =
          typeof action === "function" ? action(currentIds) : action;
        return { key: topicSelectionResetKey, ids: nextIds };
      });
    },
    [topicSelectionResetKey]
  );
  const [applyingBulkTopics, setApplyingBulkTopics] = useState(false);
  const [bulkMoveDeckId, setBulkMoveDeckId] = useState("");
  const [applyingBulkAction, setApplyingBulkAction] = useState<
    "move" | "delete" | null
  >(null);
  const [bulkDeletePending, setBulkDeletePending] = useState(false);

  const multiSelect = useMultiSelect({
    visibleIds: visibleCardIds,
    selectedIds: selectedCardIds,
    setSelectedIds: setSelectedCardIds,
    disabled: false,
  });
  const selectedCards = useMemo(() => {
    const selected = new Set(selectedCardIds);
    return cards.filter((card) => selected.has(card.id));
  }, [cards, selectedCardIds]);
  const bulkTopicCapacity = useMemo(
    () => getBulkTopicCapacity(selectedCards),
    [selectedCards]
  );

  const removeFromSelection = useCallback(
    (cardId: string) => {
      setSelectedCardIds((current) =>
        current.filter((selectedId) => selectedId !== cardId)
      );
    },
    [setSelectedCardIds]
  );

  const applyTopics = useCallback(async () => {
    if (selectedCardIds.length === 0 || bulkTopicIds.length === 0) {
      feedback.showError(
        "Select cards and choose at least one Topic first."
      );
      return;
    }

    const overLimitCard = selectedCards.find((card) => {
      const current = card.topicIds ?? [];
      const additions = bulkTopicIds.filter(
        (topicId) => !current.includes(topicId)
      );
      return current.length + additions.length > MAX_LINKED_TOPICS;
    });
    if (overLimitCard) {
      feedback.showError(
        "One or more selected cards already has five Topics. Reduce its Topics before adding more."
      );
      return;
    }

    const cardsToUpdate = selectedCards.map((card) => ({
      id: card.id,
      topicIds: Array.from(
        new Set([...(card.topicIds ?? []), ...bulkTopicIds])
      ),
    }));
    setApplyingBulkTopics(true);
    feedback.clear();

    try {
      await setCardTopicsInBulk(cardsToUpdate);
      const topicIdsByCardId = new Map(
        cardsToUpdate.map((card) => [card.id, card.topicIds])
      );
      setCards((current) =>
        current.map((card) =>
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
      feedback.success(
        `Added Topics to ${cardsToUpdate.length} card${
          cardsToUpdate.length === 1 ? "" : "s"
        }.`
      );
    } catch (error) {
      console.error("Failed to add Topics to selected cards.", error);
      feedback.showError("Failed to add Topics to the selected cards.");
    } finally {
      setApplyingBulkTopics(false);
    }
  }, [
    bulkTopicIds,
    feedback,
    selectedCardIds.length,
    selectedCards,
    setBulkTopicIds,
    setCards,
    setSelectedCardIds,
  ]);

  const moveSelected = useCallback(async () => {
    if (!bulkMoveDeckId || selectedCardIds.length === 0) {
      feedback.showError("Select cards and choose a destination deck.");
      return;
    }

    setApplyingBulkAction("move");
    feedback.clear();
    try {
      await moveCardsToDeck(selectedCardIds, bulkMoveDeckId);
      const movedIds = new Set(selectedCardIds);
      setCards((current) =>
        current.map((card) =>
          movedIds.has(card.id) ? { ...card, deckId: bulkMoveDeckId } : card
        )
      );
      const movedCount = selectedCardIds.length;
      setSelectedCardIds([]);
      setBulkMoveDeckId("");
      feedback.success(
        `Moved ${movedCount} card${movedCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      console.error("Failed to move selected cards.", error);
      feedback.showError("Failed to move the selected cards.");
    } finally {
      setApplyingBulkAction(null);
    }
  }, [
    bulkMoveDeckId,
    feedback,
    selectedCardIds,
    setCards,
    setSelectedCardIds,
  ]);

  const deleteSelected = useCallback(async () => {
    if (selectedCardIds.length === 0) return;

    setApplyingBulkAction("delete");
    feedback.clear();
    try {
      await deleteCards(selectedCardIds);
      const deletedIds = new Set(selectedCardIds);
      const deletedCount = selectedCardIds.length;
      setCards((current) =>
        current.filter((card) => !deletedIds.has(card.id))
      );
      setSelectedCardIds([]);
      setBulkDeletePending(false);
      feedback.success(
        `Deleted ${deletedCount} card${deletedCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      console.error("Failed to delete selected cards.", error);
      feedback.showError("Failed to delete the selected cards.");
    } finally {
      setApplyingBulkAction(null);
    }
  }, [feedback, selectedCardIds, setCards, setSelectedCardIds]);

  return {
    selection: {
      ids: selectedCardIds,
      idSet: multiSelect.selectedIdSet,
      selectVisible: multiSelect.selectVisible,
      clear: multiSelect.clearSelection,
      remove: removeFromSelection,
      handleCheckboxClick: multiSelect.handleCheckboxClick,
    },
    topics: {
      ids: bulkTopicIds,
      setIds: setBulkTopicIds,
      capacity: bulkTopicCapacity,
      applying: applyingBulkTopics,
      apply: applyTopics,
    },
    move: {
      deckId: bulkMoveDeckId,
      setDeckId: setBulkMoveDeckId,
      applying: applyingBulkAction === "move",
      apply: moveSelected,
    },
    deletion: {
      pending: bulkDeletePending,
      setPending: setBulkDeletePending,
      applying: applyingBulkAction === "delete",
      confirm: deleteSelected,
    },
    actionInFlight: applyingBulkAction !== null,
  };
}
