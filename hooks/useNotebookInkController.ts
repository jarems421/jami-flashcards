"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { NotebookInkEditorHandle } from "@/components/workspace/NotebookInkEditor";
import type { NotebookPageStore } from "@/hooks/useNotebookPageState";
import { NOTEBOOK_INK_UI_SYNC_IDLE_MS } from "@/lib/workspace/notebook-autosave";
import {
  chooseNotebookHistorySource,
  pushNotebookHistoryEntry,
  syncInkHistoryTimestamps,
  type NotebookTextHistoryEntry,
} from "@/lib/workspace/notebook-history";
import type { NotebookTextBlock } from "@/lib/workspace/notebooks";

/** How long after a stroke ends that touch input is still treated as a palm. */
const STYLUS_TOUCH_COOLDOWN_MS = 180;

type PendingInkUi = {
  hasContent: boolean;
  undoDepth: number;
  redoDepth: number;
};

type UseNotebookInkControllerOptions = {
  pageState: NotebookPageStore;
  inkEditorRef: RefObject<NotebookInkEditorHandle | null>;
  /** Marks the page dirty. `deferUi` keeps a stroke burst off the render loop. */
  onEdit: (options?: { deferUi?: boolean; scheduleUi?: boolean }) => void;
  /** Drops any text block selection or in-flight gesture. */
  resetTextBlockInteraction: () => void;
  /** Clears a stale autosave error once the editor UI catches up. */
  onUiCommitted: () => void;
};

export type NotebookInkController = {
  inkReadyRef: RefObject<boolean>;
  inkInteractionActiveRef: RefObject<boolean>;
  stylusInteractionRef: RefObject<boolean>;
  stylusCooldownUntilRef: RefObject<number>;
  inkReady: boolean;
  inkHasContent: boolean;
  /** Combined depth across ink and text, for the toolbar buttons. */
  undoDepth: number;
  redoDepth: number;
  setInkReady: (ready: boolean) => void;
  setInkHasContent: (hasContent: boolean) => void;
  /** True while a stroke is in flight or inside its touch cooldown. */
  isInteracting: () => boolean;
  recordTextEdit: (
    previous: NotebookTextBlock[],
    next: NotebookTextBlock[]
  ) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  handleInkChange: () => void;
  handleInkHistoryChange: (undoDepth: number, redoDepth: number) => void;
  handleInteractionChange: (active: boolean) => void;
  commitUi: () => void;
  scheduleUiCommit: () => void;
  cancelUiCommit: () => void;
};

/**
 * Owns the ink editor and reconciles its history with the page's own.
 *
 * js-draw keeps its stroke history internally and reports only how deep it is,
 * so undo used to check ink first and only fall through to text blocks once
 * every stroke was gone — meaning undo did not follow the order the student
 * actually worked in. This controller keeps a stack of timestamps mirroring
 * js-draw's depth and steps whichever history moved most recently.
 */
export function useNotebookInkController({
  pageState,
  inkEditorRef,
  onEdit,
  resetTextBlockInteraction,
  onUiCommitted,
}: UseNotebookInkControllerOptions): NotebookInkController {
  const inkReadyRef = useRef(false);
  const inkInteractionActiveRef = useRef(false);
  const stylusInteractionRef = useRef(false);
  const stylusCooldownUntilRef = useRef(0);
  const uiSyncTimerRef = useRef<number | null>(null);
  const pendingUiRef = useRef<PendingInkUi | null>(null);

  const textUndoRef = useRef<NotebookTextHistoryEntry[]>([]);
  const textRedoRef = useRef<NotebookTextHistoryEntry[]>([]);
  const inkUndoStampsRef = useRef<number[]>([]);
  const inkRedoStampsRef = useRef<number[]>([]);

  const [inkReady, setInkReady] = useState(false);
  const [inkHasContent, setInkHasContent] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);

  const latestRef = useRef({ onEdit, resetTextBlockInteraction, onUiCommitted });
  useEffect(() => {
    latestRef.current = { onEdit, resetTextBlockInteraction, onUiCommitted };
  }, [onEdit, onUiCommitted, resetTextBlockInteraction]);

  const publishDepths = useCallback(() => {
    setUndoDepth(inkUndoStampsRef.current.length + textUndoRef.current.length);
    setRedoDepth(inkRedoStampsRef.current.length + textRedoRef.current.length);
  }, []);

  const cancelUiCommit = useCallback(() => {
    if (uiSyncTimerRef.current === null) return;
    window.clearTimeout(uiSyncTimerRef.current);
    uiSyncTimerRef.current = null;
  }, []);

  const commitUi = useCallback(() => {
    cancelUiCommit();
    const pending = pendingUiRef.current;
    if (pending) {
      pendingUiRef.current = null;
      setInkHasContent(pending.hasContent);
    }
    publishDepths();
    pageState.flushPendingRender();
    latestRef.current.onUiCommitted();
  }, [cancelUiCommit, pageState, publishDepths]);

  const scheduleUiCommit = useCallback(() => {
    cancelUiCommit();
    uiSyncTimerRef.current = window.setTimeout(() => {
      uiSyncTimerRef.current = null;
      commitUi();
    }, NOTEBOOK_INK_UI_SYNC_IDLE_MS);
  }, [cancelUiCommit, commitUi]);

  const isInteracting = useCallback(
    () =>
      inkInteractionActiveRef.current ||
      Boolean(inkEditorRef.current?.isInteracting()),
    [inkEditorRef]
  );

  const recordTextEdit = useCallback(
    (previous: NotebookTextBlock[], next: NotebookTextBlock[]) => {
      textUndoRef.current = pushNotebookHistoryEntry(textUndoRef.current, {
        previous,
        next,
        at: Date.now(),
      });
      // A new edit invalidates the redo branch on both histories.
      textRedoRef.current = [];
      inkRedoStampsRef.current = [];
      publishDepths();
    },
    [publishDepths]
  );

  const undo = useCallback(() => {
    const source = chooseNotebookHistorySource({
      inkTimestamp: inkUndoStampsRef.current.at(-1) ?? null,
      textTimestamp: textUndoRef.current.at(-1)?.at ?? null,
    });
    if (source === null) return;

    if (source === "ink") {
      // js-draw fires onHistoryChange, which resyncs the timestamp stacks.
      inkEditorRef.current?.undo();
      return;
    }

    const entry = textUndoRef.current.at(-1);
    if (!entry) return;
    textUndoRef.current = textUndoRef.current.slice(0, -1);
    textRedoRef.current = pushNotebookHistoryEntry(textRedoRef.current, entry);
    publishDepths();
    pageState.setTextBlocks(entry.previous);
    latestRef.current.resetTextBlockInteraction();
    latestRef.current.onEdit();
  }, [inkEditorRef, pageState, publishDepths]);

  const redo = useCallback(() => {
    const source = chooseNotebookHistorySource({
      inkTimestamp: inkRedoStampsRef.current.at(-1) ?? null,
      textTimestamp: textRedoRef.current.at(-1)?.at ?? null,
    });
    if (source === null) return;

    if (source === "ink") {
      inkEditorRef.current?.redo();
      return;
    }

    const entry = textRedoRef.current.at(-1);
    if (!entry) return;
    textRedoRef.current = textRedoRef.current.slice(0, -1);
    textUndoRef.current = pushNotebookHistoryEntry(textUndoRef.current, entry);
    publishDepths();
    pageState.setTextBlocks(entry.next);
    latestRef.current.resetTextBlockInteraction();
    latestRef.current.onEdit();
  }, [inkEditorRef, pageState, publishDepths]);

  const clearHistory = useCallback(() => {
    textUndoRef.current = [];
    textRedoRef.current = [];
    inkUndoStampsRef.current = [];
    inkRedoStampsRef.current = [];
    pendingUiRef.current = null;
    inkInteractionActiveRef.current = false;
    cancelUiCommit();
    setUndoDepth(0);
    setRedoDepth(0);
  }, [cancelUiCommit]);

  const handleInkChange = useCallback(() => {
    const current = pendingUiRef.current;
    pendingUiRef.current = {
      hasContent: inkEditorRef.current?.hasInk() ?? false,
      undoDepth: current?.undoDepth ?? inkUndoStampsRef.current.length,
      redoDepth: current?.redoDepth ?? inkRedoStampsRef.current.length,
    };
    latestRef.current.onEdit({ deferUi: true });
  }, [inkEditorRef]);

  const handleInkHistoryChange = useCallback(
    (nextUndoDepth: number, nextRedoDepth: number) => {
      const now = Date.now();
      inkUndoStampsRef.current = syncInkHistoryTimestamps(
        inkUndoStampsRef.current,
        nextUndoDepth,
        now
      );
      inkRedoStampsRef.current = syncInkHistoryTimestamps(
        inkRedoStampsRef.current,
        nextRedoDepth,
        now
      );
      pendingUiRef.current = {
        hasContent:
          pendingUiRef.current?.hasContent ??
          (inkEditorRef.current?.hasInk() ?? false),
        undoDepth: nextUndoDepth,
        redoDepth: nextRedoDepth,
      };
      scheduleUiCommit();
    },
    [inkEditorRef, scheduleUiCommit]
  );

  const handleInteractionChange = useCallback((active: boolean) => {
    inkInteractionActiveRef.current = active;
    stylusInteractionRef.current = active;
    // While a stroke is live the cooldown never expires; a palm resting on the
    // page must not be read as a touch gesture until well after the pen lifts.
    stylusCooldownUntilRef.current = active
      ? Number.POSITIVE_INFINITY
      : Date.now() + STYLUS_TOUCH_COOLDOWN_MS;
  }, []);

  useEffect(() => cancelUiCommit, [cancelUiCommit]);

  return {
    inkReadyRef,
    inkInteractionActiveRef,
    stylusInteractionRef,
    stylusCooldownUntilRef,
    inkReady,
    inkHasContent,
    undoDepth,
    redoDepth,
    setInkReady,
    setInkHasContent,
    isInteracting,
    recordTextEdit,
    undo,
    redo,
    clearHistory,
    handleInkChange,
    handleInkHistoryChange,
    handleInteractionChange,
    commitUi,
    scheduleUiCommit,
    cancelUiCommit,
  };
}
