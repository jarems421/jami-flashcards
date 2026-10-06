"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { NotebookInkEditorHandle } from "@/components/workspace/NotebookInkEditor";
import type { ExamWorkingTool } from "@/hooks/useExamWorkingTools";
import {
  installNotebookViewportZoomBlock,
  NOTEBOOK_EDITOR_LOCK_BODY_CLASS,
} from "@/lib/workspace/notebook-interaction-lock";

const TOOL_KEYS: Partial<Record<string, ExamWorkingTool>> = { p: "pen", h: "highlighter", e: "eraser" };

/**
 * Writing full screen, the way a notebook page is written on.
 *
 * Beside the question the sheet is half a screen wide on a tablet or laptop,
 * so the page is drawn at under half its size with nothing to zoom. Full
 * screen it is fitted to the screen, can be zoomed, and takes the notebook's
 * own lock: the page behind stops scrolling, the navigation goes, and the
 * animated background stops competing with the ink for frames.
 *
 * It is the same element fixed over the page rather than a copy in a portal,
 * so the editor is not rebuilt and the undo history survives.
 */
export function useExamSheetFullScreen({
  expanded,
  rootRef,
  editorRef,
  onClose,
  onPickTool,
}: {
  expanded: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  editorRef: RefObject<NotebookInkEditorHandle | null>;
  onClose: () => void;
  onPickTool: (tool: ExamWorkingTool) => void;
}) {
  const handlersRef = useRef({ onClose, onPickTool });
  useEffect(() => {
    handlersRef.current = { onClose, onPickTool };
  });

  useEffect(() => {
    if (!expanded) return;
    document.body.classList.add(NOTEBOOK_EDITOR_LOCK_BODY_CLASS);
    const releaseZoom = installNotebookViewportZoomBlock(document);
    /*
     * The notebook's keys, and only while the sheet has the screen.
     *
     * A student who has learned P, H, E and Ctrl+Z in a notebook should not
     * have to put the pen down and reach for a toolbar here. Bound to the
     * full-screen sheet rather than the page, because inline the answer box is
     * a few centimetres away and "p" belongs to whatever is being typed.
     *
     * Captured first, so Escape closes this before the sheet the page opened
     * it in.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        handlersRef.current.onClose();
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.isContentEditable || /^(input|textarea|select)$/i.test(target?.tagName ?? "")) {
        return;
      }
      const shortcut = event.ctrlKey || event.metaKey;
      if (shortcut && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editorRef.current?.redo();
        else editorRef.current?.undo();
        return;
      }
      if (shortcut && event.key.toLowerCase() === "y") {
        event.preventDefault();
        editorRef.current?.redo();
        return;
      }
      if (shortcut || event.altKey) return;
      const tool = TOOL_KEYS[event.key.toLowerCase()];
      if (!tool) return;
      event.preventDefault();
      handlersRef.current.onPickTool(tool);
    };
    document.addEventListener("keydown", onKeyDown, true);
    const frame = window.requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove(NOTEBOOK_EDITOR_LOCK_BODY_CLASS);
      releaseZoom();
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [editorRef, expanded, rootRef]);
}
