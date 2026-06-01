"use client";

import {
  type Dispatch,
  type MouseEvent,
  type PointerEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  addCardIdsToSelection,
  selectCardRange,
  toggleCardIdSelection,
} from "@/lib/study/card-selection";

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_DISTANCE_PX = 10;
const INTERACTIVE_SELECTOR =
  "button,input,textarea,select,a,label,[contenteditable='true'],[data-card-selection-ignore='true']";
const SWIPE_SELECTING_BODY_CLASS = "jami-card-swipe-selecting";

type LongPressState = {
  timerId: number | null;
  pointerId: number | null;
  startX: number;
  startY: number;
  active: boolean;
};

type UseCardSelectionOptions = {
  visibleCardIds: string[];
  selectedCardIds: string[];
  setSelectedCardIds: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
};

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest(INTERACTIVE_SELECTOR));
}

function getCardIdFromPoint(clientX: number, clientY: number) {
  if (typeof document === "undefined") return null;
  const element = document.elementFromPoint(clientX, clientY);
  const cardElement = element instanceof HTMLElement
    ? element.closest<HTMLElement>("[data-card-id]")
    : null;
  return cardElement?.dataset.cardId ?? null;
}

function setSwipeSelectionLock(enabled: boolean) {
  if (typeof document === "undefined") return;
  document.body.classList.toggle(SWIPE_SELECTING_BODY_CLASS, enabled);
  if (enabled) {
    window.getSelection?.()?.removeAllRanges();
  }
}

export function useCardSelection({
  visibleCardIds,
  selectedCardIds,
  setSelectedCardIds,
  disabled = false,
}: UseCardSelectionOptions) {
  const selectedCardIdSet = useMemo(() => new Set(selectedCardIds), [selectedCardIds]);
  const visibleCardIdSet = useMemo(() => new Set(visibleCardIds), [visibleCardIds]);
  const rangeAnchorIdRef = useRef<string | null>(null);
  const touchedDuringLongPressRef = useRef(new Set<string>());
  const longPressRef = useRef<LongPressState>({
    timerId: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    active: false,
  });

  const clearLongPressTimer = useCallback(() => {
    const state = longPressRef.current;
    if (state.timerId !== null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }
  }, []);

  const stopLongPressSelection = useCallback(() => {
    clearLongPressTimer();
    setSwipeSelectionLock(false);
    longPressRef.current.pointerId = null;
    longPressRef.current.active = false;
    touchedDuringLongPressRef.current.clear();
  }, [clearLongPressTimer]);

  useEffect(() => {
    window.addEventListener("pointerup", stopLongPressSelection);
    window.addEventListener("pointercancel", stopLongPressSelection);
    return () => {
      window.removeEventListener("pointerup", stopLongPressSelection);
      window.removeEventListener("pointercancel", stopLongPressSelection);
      clearLongPressTimer();
      setSwipeSelectionLock(false);
    };
  }, [clearLongPressTimer, stopLongPressSelection]);

  const selectCardOnly = useCallback(
    (cardId: string) => {
      if (!visibleCardIdSet.has(cardId)) return;
      touchedDuringLongPressRef.current.add(cardId);
      setSelectedCardIds((prev) => addCardIdsToSelection(prev, [cardId]));
      rangeAnchorIdRef.current = cardId;
    },
    [setSelectedCardIds, visibleCardIdSet]
  );

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
      stopLongPressSelection();
    },
    [disabled, setSelectedCardIds, stopLongPressSelection, visibleCardIds]
  );

  const handleLongPressPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const state = longPressRef.current;
      if (state.pointerId !== event.pointerId) return;

      if (!state.active) {
        const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
        if (distance > MOVE_CANCEL_DISTANCE_PX) {
          stopLongPressSelection();
        }
        return;
      }

      event.preventDefault();
      window.getSelection?.()?.removeAllRanges();

      const cardId = getCardIdFromPoint(event.clientX, event.clientY);
      if (cardId && !touchedDuringLongPressRef.current.has(cardId)) {
        selectCardOnly(cardId);
      }
    },
    [selectCardOnly, stopLongPressSelection]
  );

  const getCardLongPressHandlers = useCallback(
    (cardId: string) => ({
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (
          disabled ||
          event.pointerType === "mouse" ||
          isInteractiveTarget(event.target)
        ) {
          return;
        }

        clearLongPressTimer();
        touchedDuringLongPressRef.current.clear();
        longPressRef.current = {
          timerId: window.setTimeout(() => {
            setSwipeSelectionLock(true);
            longPressRef.current.active = true;
            selectCardOnly(cardId);
          }, LONG_PRESS_MS),
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          active: false,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        window.getSelection?.()?.removeAllRanges();
      },
      onPointerMove: handleLongPressPointerMove,
      onPointerUp: stopLongPressSelection,
      onPointerCancel: stopLongPressSelection,
    }),
    [
      clearLongPressTimer,
      disabled,
      handleLongPressPointerMove,
      selectCardOnly,
      stopLongPressSelection,
    ]
  );

  return {
    selectedCardIdSet,
    selectVisibleCards,
    clearSelection,
    handleCheckboxClick,
    getCardLongPressHandlers,
  };
}
