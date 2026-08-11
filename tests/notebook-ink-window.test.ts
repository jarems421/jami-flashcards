import { describe, expect, it } from "vitest";
import {
  getNotebookInkRenderWindow,
  isWholeNotebookInkSheet,
  sameNotebookInkRenderWindow,
  NOTEBOOK_INK_WINDOW_GRID,
} from "@/lib/workspace/notebook-ink-window";

/** An iPad-ish frame with a fitted sheet centred in it. */
const FRAME = { frameWidth: 1024, frameHeight: 1366 };
const FITTED = { sheetWidth: 960, sheetHeight: 1320 };

function centred(sheetWidth: number, sheetHeight: number) {
  return {
    pageX: (FRAME.frameWidth - sheetWidth) / 2,
    pageY: (FRAME.frameHeight - sheetHeight) / 2,
  };
}

describe("notebook ink render window", () => {
  it("paints a fitted sheet whole, exactly as before", () => {
    const window = getNotebookInkRenderWindow({
      ...FRAME,
      ...FITTED,
      ...centred(FITTED.sheetWidth, FITTED.sheetHeight),
    });

    expect(isWholeNotebookInkSheet(window)).toBe(true);
    expect(window).toMatchObject({ left: 0, top: 0, width: 960, height: 1320 });
  });

  it("paints far less than the sheet once zoomed in", () => {
    const sheetWidth = 960 * 4;
    const sheetHeight = 1320 * 4;
    const window = getNotebookInkRenderWindow({
      ...FRAME,
      sheetWidth,
      sheetHeight,
      ...centred(sheetWidth, sheetHeight),
    });

    expect(isWholeNotebookInkSheet(window)).toBe(false);
    // The saving is the point: this is what is cleared and repainted every
    // frame of a stroke, and it used to be the whole sheet.
    const painted = window.width * window.height;
    expect(painted).toBeLessThan(sheetWidth * sheetHeight * 0.3);
  });

  it("covers everything on screen, with room to spare", () => {
    const sheetWidth = 960 * 3;
    const sheetHeight = 1320 * 3;
    const pageX = -700;
    const pageY = -1500;
    const window = getNotebookInkRenderWindow({
      ...FRAME,
      sheetWidth,
      sheetHeight,
      pageX,
      pageY,
    });

    // Nothing visible may fall outside the painted slice, or there would be
    // blank paper where ink belongs.
    expect(window.left).toBeLessThanOrEqual(-pageX);
    expect(window.top).toBeLessThanOrEqual(-pageY);
    expect(window.left + window.width).toBeGreaterThanOrEqual(
      -pageX + FRAME.frameWidth
    );
    expect(window.top + window.height).toBeGreaterThanOrEqual(
      -pageY + FRAME.frameHeight
    );
    // And meaningfully more than that, so a pan has somewhere painted to go.
    expect(window.width).toBeGreaterThan(FRAME.frameWidth);
    expect(window.height).toBeGreaterThan(FRAME.frameHeight);
  });

  it("follows the sheet as it is panned", () => {
    const sheet = { sheetWidth: 960 * 4, sheetHeight: 1320 * 4 };
    const near = getNotebookInkRenderWindow({
      ...FRAME,
      ...sheet,
      pageX: -200,
      pageY: -200,
    });
    const far = getNotebookInkRenderWindow({
      ...FRAME,
      ...sheet,
      pageX: -2600,
      pageY: -3800,
    });

    expect(far.left).toBeGreaterThan(near.left);
    expect(far.top).toBeGreaterThan(near.top);
  });

  it("does not move for a small pan, so nothing is repainted", () => {
    const sheet = { sheetWidth: 960 * 4, sheetHeight: 1320 * 4 };
    const before = getNotebookInkRenderWindow({
      ...FRAME,
      ...sheet,
      pageX: -1500,
      pageY: -2000,
    });
    const nudged = getNotebookInkRenderWindow({
      ...FRAME,
      ...sheet,
      pageX: -1500 - NOTEBOOK_INK_WINDOW_GRID / 4,
      pageY: -2000 - NOTEBOOK_INK_WINDOW_GRID / 4,
    });

    expect(sameNotebookInkRenderWindow(before, nudged)).toBe(true);
  });

  it("never reaches past the edges of the sheet", () => {
    const sheet = { sheetWidth: 960 * 2, sheetHeight: 1320 * 2 };
    for (const [pageX, pageY] of [
      [0, 0],
      [-4000, -4000],
      [900, 900],
    ]) {
      const window = getNotebookInkRenderWindow({
        ...FRAME,
        ...sheet,
        pageX,
        pageY,
      });
      expect(window.left).toBeGreaterThanOrEqual(0);
      expect(window.top).toBeGreaterThanOrEqual(0);
      expect(window.left + window.width).toBeLessThanOrEqual(sheet.sheetWidth);
      expect(window.top + window.height).toBeLessThanOrEqual(sheet.sheetHeight);
    }
  });

  it("paints the whole sheet when clipping is turned off", () => {
    const sheet = { sheetWidth: 960 * 4, sheetHeight: 1320 * 4 };
    const window = getNotebookInkRenderWindow({
      ...FRAME,
      ...sheet,
      ...centred(sheet.sheetWidth, sheet.sheetHeight),
      overscan: Number.POSITIVE_INFINITY,
    });

    expect(isWholeNotebookInkSheet(window)).toBe(true);
  });

  it("survives a sheet or frame that has not been measured yet", () => {
    expect(
      isWholeNotebookInkSheet(
        getNotebookInkRenderWindow({
          sheetWidth: 0,
          sheetHeight: 0,
          pageX: 0,
          pageY: 0,
          frameWidth: 0,
          frameHeight: 0,
        })
      )
    ).toBe(true);

    const unmeasuredFrame = getNotebookInkRenderWindow({
      sheetWidth: 3840,
      sheetHeight: 5280,
      pageX: Number.NaN,
      pageY: Number.NaN,
      frameWidth: 0,
      frameHeight: 0,
    });
    expect(isWholeNotebookInkSheet(unmeasuredFrame)).toBe(true);
  });
});
