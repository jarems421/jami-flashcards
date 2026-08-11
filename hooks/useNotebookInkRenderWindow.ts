"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import {
  isWholeNotebookInkSheet,
  type NotebookInkRenderWindow,
} from "@/lib/workspace/notebook-ink-window";

/** Keeps js-draw's painted slice aligned with a zoomed notebook sheet. */
export function useNotebookInkRenderWindow(
  inkWindow: NotebookInkRenderWindow | null
) {
  const sheetWidth = inkWindow?.sheetWidth ?? 0;
  const sheetHeight = inkWindow?.sheetHeight ?? 0;
  const left = inkWindow?.left ?? 0;
  const top = inkWindow?.top ?? 0;
  const width = inkWindow?.width ?? 0;
  const height = inkWindow?.height ?? 0;
  const clipped = Boolean(inkWindow) && !isWholeNotebookInkSheet({
    sheetWidth,
    sheetHeight,
    left,
    top,
    width,
    height,
  });
  const renderWindowRef = useRef<NotebookInkRenderWindow | null>(null);
  const syncViewportRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    renderWindowRef.current = clipped
      ? { sheetWidth, sheetHeight, left, top, width, height }
      : null;
    syncViewportRef.current?.();
  }, [clipped, height, left, sheetHeight, sheetWidth, top, width]);

  const inkHostStyle: CSSProperties = clipped
    ? { left, top, width, height }
    : { inset: 0 };
  return { inkHostStyle, renderWindowRef, syncViewportRef };
}
