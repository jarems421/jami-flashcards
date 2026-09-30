"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  type CSSProperties,
  type RefObject,
} from "react";

/**
 * The tallest a growing field gets before it scrolls after all: past this an
 * answer is better read in a scrolling box than by scrolling the page past
 * the question it answers.
 */
export const AUTO_GROW_TEXTAREA_STYLE: CSSProperties = {
  maxHeight: "min(28rem, 60vh)",
  // Inline, so a resize class cannot bring back a handle that the next
  // keystroke would undo.
  resize: "none",
};

/** Sizes one field to its text; see `useAutoGrowTextarea` for why it holds its parent. */
function fitTextareaToContent(field: HTMLTextAreaElement) {
  const holder = field.parentElement;
  if (!holder) return;
  holder.style.minHeight = `${holder.offsetHeight}px`;
  field.style.height = "";
  const { clientHeight, offsetHeight, scrollHeight } = field;
  // Also true of a field that is not laid out yet, which keeps its rows.
  if (scrollHeight > clientHeight) {
    field.style.height = `${scrollHeight + offsetHeight - clientHeight}px`;
  }
  holder.style.minHeight = "";
}

/**
 * A text area that grows with what is written, from its `rows` up to a cap,
 * instead of scrolling a long answer inside a small box.
 *
 * Measuring means letting the field fall back to its rows for a moment, and a
 * page that briefly got shorter would have its scroll position clamped -- the
 * classic growing-field jump, where deleting a line throws the page up the
 * screen. The field's parent is held at its current height while measuring,
 * so everything around the field stays exactly where it was.
 *
 * Returns the fit, for input a caller knows about that React does not.
 */
export function useAutoGrowTextarea(
  fieldRef: RefObject<HTMLTextAreaElement | null>,
  { enabled = true, value }: { enabled?: boolean; value?: unknown } = {}
) {
  const fit = useCallback(() => {
    if (enabled && fieldRef.current) fitTextareaToContent(fieldRef.current);
  }, [enabled, fieldRef]);

  useLayoutEffect(() => {
    fit();
  }, [fit, value]);

  // A narrower field wraps onto more lines. Only width is watched: fitting
  // changes the height, and reacting to that would chase its own tail.
  useEffect(() => {
    const field = fieldRef.current;
    if (!enabled || !field || typeof ResizeObserver === "undefined") return;
    let width = field.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (field.offsetWidth === width) return;
      width = field.offsetWidth;
      fit();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [enabled, fieldRef, fit]);

  return fit;
}
