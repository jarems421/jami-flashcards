"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  applyNotebookPageStateAction,
  INITIAL_NOTEBOOK_PAGE_STATE,
  type NotebookEditorTool,
  type NotebookPageState,
  type NotebookPageStateAction,
  type NotebookSaveStatus,
} from "@/lib/workspace/notebook-page-state";
import type {
  NotebookPage,
  NotebookPageColor,
  NotebookPageStyle,
  NotebookTextBlock,
} from "@/lib/workspace/notebooks";

type TextBlocksUpdate =
  | NotebookTextBlock[]
  | ((previous: NotebookTextBlock[]) => NotebookTextBlock[]);

export type NotebookPageWriteOptions = {
  /**
   * Commit the value without re-rendering yet. The ink hot path uses this so a
   * burst of strokes does not schedule a React render per stroke; call
   * {@link NotebookPageStore.flushPendingRender} once the burst settles.
   */
  deferRender?: boolean;
};

export type NotebookPageStore = {
  /**
   * Latest committed values, readable synchronously from an event handler.
   * Always at least as fresh as the rendered state.
   */
  read: () => NotebookPageState;
  dispatch: (
    action: NotebookPageStateAction,
    options?: NotebookPageWriteOptions
  ) => void;
  /** Pushes any deferred write into the rendered state. */
  flushPendingRender: () => void;
  selectPage: (page: NotebookPage | null) => void;
  hydratePage: (pageId: string, contentRevision: number) => void;
  resetHydration: () => void;
  setTextBlocks: (update: TextBlocksUpdate) => void;
  setPageColor: (pageColor: NotebookPageColor) => void;
  setPageStyle: (pageStyle: NotebookPageStyle) => void;
  setSaveStatus: (
    saveStatus: NotebookSaveStatus,
    options?: NotebookPageWriteOptions
  ) => void;
  setTool: (tool: NotebookEditorTool) => void;
  setContentRevision: (contentRevision: number) => void;
  resetForNotebookChange: () => void;
};

export type UseNotebookPageStateResult = {
  /**
   * Stable for the lifetime of the component, so it can sit in a dependency
   * array without invalidating the callback on every state change.
   */
  store: NotebookPageStore;
  /** Render-time snapshot. Prefer `store.read()` inside event handlers. */
  state: NotebookPageState;
};

/**
 * Single source of truth for the notebook state shared across controllers.
 *
 * The page previously kept a `useState` and a mirror `useRef` for each of these
 * values, synced by effects and by hand — `saveStatusRef.current = "saved"`
 * next to `setSaveStatus("saved")`, seven times over. Every write now goes
 * through one reducer that updates the ref and the rendered state together, so
 * the two cannot disagree.
 */
export function useNotebookPageState(): UseNotebookPageStateResult {
  const [state, setState] = useState<NotebookPageState>(
    INITIAL_NOTEBOOK_PAGE_STATE
  );
  const stateRef = useRef<NotebookPageState>(INITIAL_NOTEBOOK_PAGE_STATE);

  const pendingRenderRef = useRef(false);

  const read = useCallback(() => stateRef.current, []);

  const dispatch = useCallback(
    (
      action: NotebookPageStateAction,
      options?: NotebookPageWriteOptions
    ) => {
      const next = applyNotebookPageStateAction(stateRef.current, action);
      if (next === stateRef.current) return;
      // The ref moves first so a handler running before React re-renders still
      // sees the value it just wrote.
      stateRef.current = next;
      if (options?.deferRender) {
        pendingRenderRef.current = true;
        return;
      }
      pendingRenderRef.current = false;
      setState(next);
    },
    []
  );

  const flushPendingRender = useCallback(() => {
    if (!pendingRenderRef.current) return;
    pendingRenderRef.current = false;
    setState(stateRef.current);
  }, []);

  const store = useMemo<NotebookPageStore>(
    () => ({
      read,
      dispatch,
      flushPendingRender,
      selectPage: (page) => dispatch({ type: "selectPage", page }),
      hydratePage: (pageId, contentRevision) =>
        dispatch({ type: "hydratePage", pageId, contentRevision }),
      resetHydration: () => dispatch({ type: "resetHydration" }),
      setTextBlocks: (update) =>
        dispatch({
          type: "setTextBlocks",
          textBlocks:
            typeof update === "function"
              ? update(stateRef.current.textBlocks)
              : update,
        }),
      setPageColor: (pageColor) => dispatch({ type: "setPageColor", pageColor }),
      setPageStyle: (pageStyle) => dispatch({ type: "setPageStyle", pageStyle }),
      setSaveStatus: (saveStatus, options) =>
        dispatch({ type: "setSaveStatus", saveStatus }, options),
      setTool: (tool) => dispatch({ type: "setTool", tool }),
      setContentRevision: (contentRevision) =>
        dispatch({ type: "setContentRevision", contentRevision }),
      resetForNotebookChange: () => dispatch({ type: "resetForNotebookChange" }),
    }),
    [dispatch, flushPendingRender, read]
  );

  return { store, state };
}
