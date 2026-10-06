"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Focus follows the working sheet while it covers the screen, and the page
 * behind it is hidden from screen readers -- without this a keyboard user
 * could tab from a full-screen working sheet into the answer box underneath.
 *
 * The question and the answer sit in different columns from the sheet, so
 * each is marked `data-behind-working` rather than hiding a shared parent that
 * holds the sheet.
 */
export function useExamWorkingDialog({
  open,
  sheetRef,
}: {
  open: boolean;
  sheetRef: RefObject<HTMLDivElement | null>;
}) {
  /** Where focus was before the sheet covered the screen, so it can go back. */
  const focusBeforeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const behind = Array.from(document.querySelectorAll<HTMLElement>("[data-behind-working]"));
    if (!open) {
      behind.forEach((element) => element.removeAttribute("aria-hidden"));
      focusBeforeRef.current?.focus?.();
      focusBeforeRef.current = null;
      return;
    }
    focusBeforeRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    behind.forEach((element) => element.setAttribute("aria-hidden", "true"));
    const frame = window.requestAnimationFrame(() => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      sheet.setAttribute("tabindex", "-1");
      sheet.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      behind.forEach((element) => element.removeAttribute("aria-hidden"));
    };
  }, [open, sheetRef]);
}
