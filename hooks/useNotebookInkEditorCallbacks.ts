"use client";

import { useCallback, useEffect, useRef } from "react";
import type { NotebookInkEditorCallbacks } from "@/components/workspace/notebook-ink-editor-types";
import { setNotebookInkContact } from "@/lib/workspace/notebook-ink-activity";

/**
 * The page's callbacks as an ink editor's long-lived code reads them, and how
 * the editor reports a pen going down or up.
 *
 * The callbacks are held in a ref and kept current, so the pointer handlers and
 * the engine's listeners can be built once and still call the latest ones.
 */
export function useNotebookInkEditorCallbacks({
  onChange,
  onHistoryChange,
  onInteractionChange,
  onReady,
  onReadyError,
}: NotebookInkEditorCallbacks) {
  const callbacksRef = useRef<NotebookInkEditorCallbacks>({
    onChange,
    onHistoryChange,
    onInteractionChange,
    onReady,
    onReadyError,
  });
  useEffect(() => {
    callbacksRef.current = {
      onChange,
      onHistoryChange,
      onInteractionChange,
      onReady,
      onReadyError,
    };
  }, [onChange, onHistoryChange, onInteractionChange, onReady, onReadyError]);

  /** This editor's identity in the app-wide pen signal. */
  const inkActivityOwnerRef = useRef<object>({});
  /**
   * Tells the page and the rest of the app whether a pen is down. The
   * app-wide signal is what holds the PDF render and the export back.
   */
  const reportInteraction = useCallback((active: boolean) => {
    setNotebookInkContact(inkActivityOwnerRef.current, active);
    callbacksRef.current.onInteractionChange(active);
  }, []);

  return { callbacksRef, reportInteraction };
}
