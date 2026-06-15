"use client";

import {
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  addCardIdsToSelection,
  selectCardRange,
  toggleCardIdSelection,
} from "@/lib/study/card-selection";

type UseCardSelectionOptions = {
  visibleCardIds: string[];
  selectedCardIds: string[];
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
};

export function useCardSelection({
  visibleCardIds,
  selectedCardIds,
  setSelectedCardIds,
  disabled = false,
}: UseCardSelectionOptions) {
  const selectedCardIdSet = useMemo(() => new Set(selectedCardIds), [selectedCardIds]);
  const rangeAnchorIdRef = useRef<string | null>(null);

  const selectVisibleCards = useCallback(() => {
    setSelectedCardIds((prev) => addCardIdsToSelection(prev, visibleCardIds));
  }, [setSelectedCardIds, visibleCardIds]);

  const clearSelection = useCallback(() => {
    setSelectedCardIds([]);
    rangeAnchorIdRef.current = null;
  }, [setSelectedCardIds]);

  const handleCheckboxClick = useCallback(
    (cardId: string, event: MouseEvent<HTMLInputElement>) => {
      if (disabled) return;

      if (event.shiftKey) {
        setSelectedCardIds((prev) =>
          selectCardRange(prev, visibleCardIds, rangeAnchorIdRef.current, cardId)
        );
      } else {
        setSelectedCardIds((prev) => toggleCardIdSelection(prev, cardId));
      }

      rangeAnchorIdRef.current = cardId;
    },
    [disabled, setSelectedCardIds, visibleCardIds]
  );

  return {
    selectedCardIdSet,
    selectVisibleCards,
    clearSelection,
    handleCheckboxClick,
  };
}
