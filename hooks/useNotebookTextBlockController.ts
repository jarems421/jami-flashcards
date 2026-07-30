"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type {
  NotebookTextBlock,
  NotebookTextBlockResizeEdge,
} from "@/lib/workspace/notebooks";
import type { NotebookPageStore } from "@/hooks/useNotebookPageState";
import {
  MAX_NOTEBOOK_TEXT_BLOCKS,
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  resizeNotebookTextBlockFromEdge,
} from "@/lib/workspace/notebooks";
import {
  clampNotebookTextBlock,
  getNotebookTextBlockOptionsElementId,
  makeNotebookTextBlockId,
} from "@/lib/workspace/notebook-page-content";
import {
  isTextResizeHandleTarget,
  safelyReleasePointerCapture,
  safelySetPointerCapture,
} from "@/lib/workspace/notebook-interaction-lock";

type Point = { x: number; y: number };

type TextBlockGestureState = {
  id: string;
  pointerId: number;
  captureTarget: HTMLElement;
  pageElement: HTMLElement;
  previousTextBlocks: NotebookTextBlock[];
};

type TextBlockDragState = TextBlockGestureState & {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  pageWidth: number;
  pageHeight: number;
  /**
   * A motionless release only enters editing when the block was selected
   * before this gesture began.
   */
  wasSelected: boolean;
};

type TextBlockResizeState = TextBlockGestureState & {
  edge: NotebookTextBlockResizeEdge;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
  originText: string;
  pageWidth: number;
  pageHeight: number;
};

type TouchEndOptions = {
  cancelled?: boolean;
};

type UseNotebookTextBlockControllerOptions = {
  editingEnabled: boolean;
  isNavigationLocked: () => boolean;
  /** Single source of truth for the page content this controller edits. */
  pageState: NotebookPageStore;
  pageSurfaceRef: RefObject<HTMLDivElement | null>;
  onChange: () => void;
  onHistoryCommit: (
    previous: NotebookTextBlock[],
    next: NotebookTextBlock[]
  ) => void;
  onGestureStart: () => void;
  onCreateLimitReached: (maximum: number) => void;
  onCreateComplete: () => void;
  onTouchPointerDown: (event: ReactPointerEvent<HTMLElement>) => unknown;
  onTouchPointerMove: (event: ReactPointerEvent<HTMLElement>) => unknown;
  onTouchPointerEnd: (
    event: ReactPointerEvent<HTMLElement>,
    options?: TouchEndOptions
  ) => unknown;
};

function releaseTextBlockGestureCapture(
  gesture: TextBlockGestureState | null,
  pageSurface: HTMLElement | null
) {
  if (!gesture) return;
  safelyReleasePointerCapture(gesture.captureTarget, gesture.pointerId);
  if (gesture.pageElement !== gesture.captureTarget) {
    safelyReleasePointerCapture(gesture.pageElement, gesture.pointerId);
  }
  if (
    pageSurface &&
    pageSurface !== gesture.captureTarget &&
    pageSurface !== gesture.pageElement
  ) {
    safelyReleasePointerCapture(pageSurface, gesture.pointerId);
  }
}

export function useNotebookTextBlockController({
  editingEnabled,
  isNavigationLocked,
  pageState,
  pageSurfaceRef,
  onChange,
  onHistoryCommit,
  onGestureStart,
  onCreateLimitReached,
  onCreateComplete,
  onTouchPointerDown,
  onTouchPointerMove,
  onTouchPointerEnd,
}: UseNotebookTextBlockControllerOptions) {
  const [selectedTextBlockId, setSelectedTextBlockId] = useState<string | null>(
    null
  );
  const [editingTextBlockId, setEditingTextBlockId] = useState<string | null>(
    null
  );
  const [openTextBlockOptionsId, setOpenTextBlockOptionsId] = useState<
    string | null
  >(null);
  const [activeTextGestureId, setActiveTextGestureId] = useState<string | null>(
    null
  );
  const textBlockDragRef = useRef<TextBlockDragState | null>(null);
  const textBlockResizeRef = useRef<TextBlockResizeState | null>(null);

  const resetTextBlockInteraction = useCallback(() => {
    releaseTextBlockGestureCapture(
      textBlockDragRef.current,
      pageSurfaceRef.current
    );
    releaseTextBlockGestureCapture(
      textBlockResizeRef.current,
      pageSurfaceRef.current
    );
    textBlockDragRef.current = null;
    textBlockResizeRef.current = null;
    setSelectedTextBlockId(null);
    setEditingTextBlockId(null);
    setOpenTextBlockOptionsId(null);
    setActiveTextGestureId(null);
  }, [pageSurfaceRef]);

  const clearTextBlockSelection = useCallback(() => {
    setSelectedTextBlockId(null);
    setEditingTextBlockId(null);
    setOpenTextBlockOptionsId(null);
  }, []);

  const selectTextBlock = useCallback(
    (blockId: string) => {
      setOpenTextBlockOptionsId(null);
      if (selectedTextBlockId !== blockId) {
        setEditingTextBlockId(null);
      }
      setSelectedTextBlockId(blockId);
    },
    [selectedTextBlockId]
  );

  const startEditingTextBlock = useCallback((blockId: string) => {
    setOpenTextBlockOptionsId(null);
    setSelectedTextBlockId(blockId);
    setEditingTextBlockId(blockId);
  }, []);

  const stopEditingTextBlock = useCallback(() => {
    setEditingTextBlockId(null);
  }, []);

  const setTextBlockOptionsOpen = useCallback(
    (blockId: string, open: boolean) => {
      setOpenTextBlockOptionsId(open ? blockId : null);
    },
    []
  );

  useEffect(() => {
    if (!openTextBlockOptionsId || typeof window === "undefined") return;

    const focusFrame = window.requestAnimationFrame(() => {
      const menu = document.getElementById(
        getNotebookTextBlockOptionsElementId(openTextBlockOptionsId, "menu")
      );
      menu
        ?.querySelector<HTMLElement>('[role="menuitemcheckbox"]')
        ?.focus({ preventScroll: true });
    });
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-text-block-options-root]")
      ) {
        return;
      }
      setOpenTextBlockOptionsId(null);
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener(
        "pointerdown",
        handleOutsidePointerDown,
        true
      );
    };
  }, [openTextBlockOptionsId]);

  const createTextBlockAtPoint = useCallback(
    (point: Point) => {
      if (pageState.read().textBlocks.length >= MAX_NOTEBOOK_TEXT_BLOCKS) {
        onCreateLimitReached(MAX_NOTEBOOK_TEXT_BLOCKS);
        return;
      }

      const block = clampNotebookTextBlock({
        id: makeNotebookTextBlockId(),
        x: point.x - 120,
        y: point.y - 36,
        width: 300,
        height: 96,
        text: "",
        outlineVisible: true,
      });
      pageState.setTextBlocks((current) => {
        const next = [...current, block];
        onHistoryCommit(current, next);
        return next;
      });
      setSelectedTextBlockId(block.id);
      setEditingTextBlockId(block.id);
      setOpenTextBlockOptionsId(null);
      onChange();
      onCreateComplete();
    },
    [
      onChange,
      onCreateComplete,
      onCreateLimitReached,
      onHistoryCommit,
      pageState,
    ]
  );

  const updateTextBlock = useCallback(
    (blockId: string, updates: Partial<NotebookTextBlock>) => {
      pageState.setTextBlocks((current) =>
        current.map((block) =>
          block.id === blockId
            ? clampNotebookTextBlock({ ...block, ...updates })
            : block
        )
      );
      onChange();
    },
    [onChange, pageState]
  );

  const toggleTextBlockOutline = useCallback(
    (blockId: string) => {
      pageState.setTextBlocks((current) => {
        const next = current.map((block) =>
          block.id === blockId
            ? { ...block, outlineVisible: !block.outlineVisible }
            : block
        );
        if (next.some((block, index) => block !== current[index])) {
          onHistoryCommit(current, next);
        }
        return next;
      });
      onChange();
    },
    [onChange, onHistoryCommit, pageState]
  );

  const deleteTextBlock = useCallback(
    (blockId: string) => {
      pageState.setTextBlocks((current) => {
        const next = current.filter((block) => block.id !== blockId);
        if (next.length !== current.length) {
          onHistoryCommit(current, next);
        }
        return next;
      });
      setSelectedTextBlockId((current) =>
        current === blockId ? null : current
      );
      setEditingTextBlockId((current) =>
        current === blockId ? null : current
      );
      setOpenTextBlockOptionsId((current) =>
        current === blockId ? null : current
      );
      onChange();
    },
    [onChange, onHistoryCommit, pageState]
  );

  const handleTextBlockOptionsKeyDown = useCallback(
    (blockId: string, event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Tab") {
        setOpenTextBlockOptionsId(null);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpenTextBlockOptionsId(null);
        window.requestAnimationFrame(() => {
          document
            .getElementById(
              getNotebookTextBlockOptionsElementId(blockId, "trigger")
            )
            ?.focus({ preventScroll: true });
        });
        return;
      }
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }

      const menuItems = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          '[role="menuitemcheckbox"], [role="menuitem"]'
        )
      );
      if (menuItems.length === 0) return;
      event.preventDefault();
      const currentIndex = menuItems.indexOf(
        document.activeElement as HTMLButtonElement
      );
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? menuItems.length - 1
            : event.key === "ArrowUp"
              ? (currentIndex - 1 + menuItems.length) % menuItems.length
              : (currentIndex + 1) % menuItems.length;
      menuItems[nextIndex]?.focus({ preventScroll: true });
    },
    []
  );

  const commitCompletedTextBlockDrag = useCallback(
    (drag: TextBlockDragState) => {
      const next = pageState.read().textBlocks;
      const previousBlock = drag.previousTextBlocks.find(
        (block) => block.id === drag.id
      );
      const nextBlock = next.find((block) => block.id === drag.id);
      if (
        previousBlock &&
        nextBlock &&
        (previousBlock.x !== nextBlock.x || previousBlock.y !== nextBlock.y)
      ) {
        onHistoryCommit(drag.previousTextBlocks, next);
      }
    },
    [onHistoryCommit, pageState]
  );

  const commitCompletedTextBlockResize = useCallback(
    (resize: TextBlockResizeState) => {
      const next = pageState.read().textBlocks;
      const previousBlock = resize.previousTextBlocks.find(
        (block) => block.id === resize.id
      );
      const nextBlock = next.find((block) => block.id === resize.id);
      if (
        previousBlock &&
        nextBlock &&
        (previousBlock.x !== nextBlock.x ||
          previousBlock.y !== nextBlock.y ||
          previousBlock.width !== nextBlock.width ||
          previousBlock.height !== nextBlock.height)
      ) {
        onHistoryCommit(resize.previousTextBlocks, next);
      }
    },
    [onHistoryCommit, pageState]
  );

  const finishActiveTextBlockGesture = useCallback(() => {
    const resize = textBlockResizeRef.current;
    const drag = textBlockDragRef.current;
    if (resize) {
      commitCompletedTextBlockResize(resize);
    } else if (drag) {
      commitCompletedTextBlockDrag(drag);
    }
    releaseTextBlockGestureCapture(drag, pageSurfaceRef.current);
    releaseTextBlockGestureCapture(resize, pageSurfaceRef.current);
    textBlockDragRef.current = null;
    textBlockResizeRef.current = null;
    setActiveTextGestureId(null);
  }, [
    commitCompletedTextBlockDrag,
    commitCompletedTextBlockResize,
    pageSurfaceRef,
  ]);

  const startTextBlockDrag = useCallback(
    (
      block: NotebookTextBlock,
      event: ReactPointerEvent<HTMLElement>
    ) => {
      if (!editingEnabled || isNavigationLocked()) return;
      if (isTextResizeHandleTarget(event.target)) return;
      if (textBlockDragRef.current || textBlockResizeRef.current) return;
      setOpenTextBlockOptionsId(null);
      const pageElement = event.currentTarget.closest<HTMLElement>(
        "[data-notebook-page-surface]"
      );
      if (!pageElement) return;
      const rect = pageElement.getBoundingClientRect();
      textBlockDragRef.current = {
        id: block.id,
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        pageElement,
        startX: event.clientX,
        startY: event.clientY,
        originX: block.x,
        originY: block.y,
        pageWidth: rect.width,
        pageHeight: rect.height,
        previousTextBlocks: pageState.read().textBlocks,
        wasSelected: selectedTextBlockId === block.id,
      };
      onGestureStart();
      setActiveTextGestureId(block.id);
      setSelectedTextBlockId(block.id);
      setEditingTextBlockId(null);
      safelySetPointerCapture(event.currentTarget, event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    },
    [
      editingEnabled,
      isNavigationLocked,
      onGestureStart,
      selectedTextBlockId,
      pageState,
    ]
  );

  const dragTextBlock = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = textBlockDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx =
        ((event.clientX - drag.startX) / drag.pageWidth) *
        NOTEBOOK_PAGE_COORDINATE_WIDTH;
      const dy =
        ((event.clientY - drag.startY) / drag.pageHeight) *
        NOTEBOOK_PAGE_COORDINATE_HEIGHT;
      updateTextBlock(drag.id, {
        x: drag.originX + dx,
        y: drag.originY + dy,
      });
      event.preventDefault();
      event.stopPropagation();
    },
    [updateTextBlock]
  );

  const stopTextBlockDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = textBlockDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      releaseTextBlockGestureCapture(drag, pageSurfaceRef.current);
      commitCompletedTextBlockDrag(drag);

      const movedX = Math.abs(event.clientX - drag.startX);
      const movedY = Math.abs(event.clientY - drag.startY);
      if (
        drag.wasSelected &&
        event.type === "pointerup" &&
        movedX < 6 &&
        movedY < 6
      ) {
        setEditingTextBlockId(drag.id);
      }
      textBlockDragRef.current = null;
      setActiveTextGestureId(null);
      event.stopPropagation();
    },
    [commitCompletedTextBlockDrag, pageSurfaceRef]
  );

  const startTextBlockResize = useCallback(
    (
      block: NotebookTextBlock,
      edge: NotebookTextBlockResizeEdge,
      event: ReactPointerEvent<HTMLElement>
    ) => {
      if (!editingEnabled || isNavigationLocked()) return;
      if (textBlockDragRef.current || textBlockResizeRef.current) return;
      setOpenTextBlockOptionsId(null);
      const pageElement = event.currentTarget.closest<HTMLElement>(
        "[data-notebook-page-surface]"
      );
      if (!pageElement) return;
      const rect = pageElement.getBoundingClientRect();
      textBlockResizeRef.current = {
        id: block.id,
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        pageElement,
        edge,
        startX: event.clientX,
        startY: event.clientY,
        originX: block.x,
        originY: block.y,
        originWidth: block.width,
        originHeight: block.height,
        originText: block.text,
        pageWidth: rect.width,
        pageHeight: rect.height,
        previousTextBlocks: pageState.read().textBlocks,
      };
      onGestureStart();
      setActiveTextGestureId(block.id);
      setSelectedTextBlockId(block.id);
      safelySetPointerCapture(event.currentTarget, event.pointerId);
      safelySetPointerCapture(pageElement, event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    },
    [
      editingEnabled,
      isNavigationLocked,
      onGestureStart,
      pageState,
    ]
  );

  const resizeTextBlock = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const resize = textBlockResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      const dx =
        ((event.clientX - resize.startX) / resize.pageWidth) *
        NOTEBOOK_PAGE_COORDINATE_WIDTH;
      const dy =
        ((event.clientY - resize.startY) / resize.pageHeight) *
        NOTEBOOK_PAGE_COORDINATE_HEIGHT;
      const currentBlock = pageState.read().textBlocks.find(
        (block) => block.id === resize.id
      );
      const nextBlock = resizeNotebookTextBlockFromEdge({
        block: {
          id: resize.id,
          x: resize.originX,
          y: resize.originY,
          width: resize.originWidth,
          height: resize.originHeight,
          text: currentBlock?.text ?? resize.originText,
          outlineVisible: currentBlock?.outlineVisible ?? true,
        },
        edge: resize.edge,
        deltaX: dx,
        deltaY: dy,
      });
      updateTextBlock(resize.id, nextBlock);
      event.preventDefault();
      event.stopPropagation();
    },
    [pageState, updateTextBlock]
  );

  const stopTextBlockResize = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const resize = textBlockResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      releaseTextBlockGestureCapture(resize, pageSurfaceRef.current);
      commitCompletedTextBlockResize(resize);
      textBlockResizeRef.current = null;
      setActiveTextGestureId(null);
      event.stopPropagation();
    },
    [commitCompletedTextBlockResize, pageSurfaceRef]
  );

  const handleTextBlockPointerDown = useCallback(
    (
      block: NotebookTextBlock,
      event: ReactPointerEvent<HTMLElement>
    ) => {
      const selected = selectedTextBlockId === block.id;
      const editing = editingTextBlockId === block.id;
      if (event.pointerType === "touch" && !selected && !editing) {
        onTouchPointerDown(event);
        return;
      }
      if (!editing) {
        startTextBlockDrag(block, event);
      }
    },
    [
      editingTextBlockId,
      onTouchPointerDown,
      selectedTextBlockId,
      startTextBlockDrag,
    ]
  );

  const handleTextBlockPointerMove = useCallback(
    (
      block: NotebookTextBlock,
      event: ReactPointerEvent<HTMLElement>
    ) => {
      const selected = selectedTextBlockId === block.id;
      const editing = editingTextBlockId === block.id;
      if (event.pointerType === "touch" && !selected && !editing) {
        onTouchPointerMove(event);
        return;
      }
      if (textBlockResizeRef.current?.id === block.id) {
        resizeTextBlock(event);
        return;
      }
      if (!editing) {
        dragTextBlock(event);
      }
    },
    [
      dragTextBlock,
      editingTextBlockId,
      onTouchPointerMove,
      resizeTextBlock,
      selectedTextBlockId,
    ]
  );

  const handleTextBlockPointerUp = useCallback(
    (
      block: NotebookTextBlock,
      event: ReactPointerEvent<HTMLElement>
    ) => {
      const selected = selectedTextBlockId === block.id;
      const editing = editingTextBlockId === block.id;
      if (event.pointerType === "touch" && !selected && !editing) {
        onTouchPointerEnd(event);
        return;
      }
      if (textBlockResizeRef.current?.id === block.id) {
        stopTextBlockResize(event);
        return;
      }
      if (!editing) {
        stopTextBlockDrag(event);
      }
    },
    [
      editingTextBlockId,
      onTouchPointerEnd,
      selectedTextBlockId,
      stopTextBlockDrag,
      stopTextBlockResize,
    ]
  );

  const handleTextBlockPointerCancel = useCallback(
    (
      block: NotebookTextBlock,
      event: ReactPointerEvent<HTMLElement>
    ) => {
      const selected = selectedTextBlockId === block.id;
      const editing = editingTextBlockId === block.id;
      if (event.pointerType === "touch" && !selected && !editing) {
        onTouchPointerEnd(event, { cancelled: true });
        return;
      }
      if (textBlockResizeRef.current?.id === block.id) {
        stopTextBlockResize(event);
        return;
      }
      if (!editing) {
        stopTextBlockDrag(event);
      }
    },
    [
      editingTextBlockId,
      onTouchPointerEnd,
      selectedTextBlockId,
      stopTextBlockDrag,
      stopTextBlockResize,
    ]
  );

  const handlePageSurfaceTextGestureMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (textBlockResizeRef.current) {
        resizeTextBlock(event);
        return;
      }
      if (textBlockDragRef.current) {
        dragTextBlock(event);
      }
    },
    [dragTextBlock, resizeTextBlock]
  );

  const handlePageSurfaceTextGestureStop = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (textBlockResizeRef.current) {
        stopTextBlockResize(event);
        return;
      }
      if (textBlockDragRef.current) {
        stopTextBlockDrag(event);
      }
    },
    [stopTextBlockDrag, stopTextBlockResize]
  );

  return {
    selectedTextBlockId,
    editingTextBlockId,
    openTextBlockOptionsId,
    activeTextGestureId,
    resetTextBlockInteraction,
    finishActiveTextBlockGesture,
    clearTextBlockSelection,
    selectTextBlock,
    startEditingTextBlock,
    stopEditingTextBlock,
    setTextBlockOptionsOpen,
    createTextBlockAtPoint,
    updateTextBlock,
    toggleTextBlockOutline,
    deleteTextBlock,
    handleTextBlockOptionsKeyDown,
    startTextBlockDrag,
    dragTextBlock,
    stopTextBlockDrag,
    startTextBlockResize,
    resizeTextBlock,
    stopTextBlockResize,
    handleTextBlockPointerDown,
    handleTextBlockPointerMove,
    handleTextBlockPointerUp,
    handleTextBlockPointerCancel,
    handlePageSurfaceTextGestureMove,
    handlePageSurfaceTextGestureStop,
  };
}
