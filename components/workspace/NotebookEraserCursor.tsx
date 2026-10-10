"use client";

import { forwardRef } from "react";

/**
 * The eraser's ring: sized for the chosen thickness by React, and placed and
 * shown by the pointer handlers, which write its transform and opacity directly
 * so a moving pen never renders anything.
 */
export const NotebookEraserCursor = forwardRef<HTMLDivElement, { diameter: number }>(
  function NotebookEraserCursor({ diameter }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        data-testid="notebook-eraser-cursor"
        /*
         * Outlined in both polarities: a pale ring with a dark one just
         * inside and outside it. A single dark outline disappeared on a
         * black page, and a single pale one would disappear on a white
         * one -- and neither can be chosen from the page colour anyway,
         * since the ring also has to stay visible over an imported PDF
         * page, which can be anything at all.
         */
        /*
         * Drawn on both sides of the edge at once, so the swatch outline reads against
         * a white page and a black one without knowing which it is on.
         */
        // eslint-disable-next-line no-restricted-syntax
        className="pointer-events-none absolute left-0 top-0 z-30 box-border aspect-square rounded-full border-2 border-white/85 bg-transparent opacity-0 shadow-[0_0_0_1.5px_rgba(2,6,23,0.55),inset_0_0_0_1.5px_rgba(2,6,23,0.55)] will-change-transform"
        style={{ width: diameter, height: diameter }}
      />
    );
  }
);
