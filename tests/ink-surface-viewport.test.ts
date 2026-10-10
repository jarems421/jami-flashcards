import { describe, expect, it } from "vitest";
import {
  inkClientToPage,
  inkScribbleInPageUnits,
  inkSurfaceViewport,
} from "@/lib/ink-dom/surface-viewport";

const PAGE = { width: 900, height: 1240 };

describe("inkSurfaceViewport", () => {
  it("maps a fitted sheet whole: scale, density, origin and the whole sheet visible", () => {
    const result = inkSurfaceViewport({
      rect: { left: 40, top: 30, width: 450, height: 620 },
      page: PAGE,
      devicePixelRatio: 2,
    });
    expect(result).toEqual({
      mapping: { left: 40, top: 30, scale: 0.5 },
      viewport: {
        scale: 0.5,
        devicePixelRatio: 2,
        visible: { left: 0, top: 0, width: 450, height: 620 },
        screenOrigin: { x: 40, y: 30 },
      },
    });
  });

  it("takes the visible part from the frame: it lies at (-pageX, -pageY) in sheet coordinates", () => {
    // Zoomed to 3x, so the sheet is 2700 x 3720, pushed left and up inside a 1000 x 800 frame.
    const result = inkSurfaceViewport({
      rect: { left: -500, top: -300, width: 2700, height: 3720 },
      page: PAGE,
      devicePixelRatio: 1,
      frame: { pageX: -500, pageY: -300, frameWidth: 1000, frameHeight: 800 },
    });
    expect(result?.viewport.visible).toEqual({ left: 500, top: 300, width: 1000, height: 800 });
    expect(result?.viewport.scale).toBe(3);
    expect(result?.mapping).toEqual({ left: -500, top: -300, scale: 3 });
  });

  it("keeps the frame to the sheet when the sheet starts inside it or ends before it does", () => {
    const starts = inkSurfaceViewport({
      rect: { left: 100, top: 60, width: 450, height: 620 },
      page: PAGE,
      devicePixelRatio: 1,
      frame: { pageX: 100, pageY: 60, frameWidth: 1000, frameHeight: 400 },
    });
    // The frame reaches 100 px further left and 60 px further up than the sheet.
    expect(starts?.viewport.visible).toEqual({ left: 0, top: 0, width: 450, height: 340 });

    const ends = inkSurfaceViewport({
      rect: { left: -200, top: 0, width: 450, height: 620 },
      page: PAGE,
      devicePixelRatio: 1,
      frame: { pageX: -200, pageY: 0, frameWidth: 400, frameHeight: 700 },
    });
    expect(ends?.viewport.visible).toEqual({ left: 200, top: 0, width: 250, height: 620 });
  });

  it("uses the frame in preference to the snapped window, and the window when there is no frame", () => {
    const rect = { left: 0, top: 0, width: 1800, height: 2480 };
    const window = { left: 128, top: 256, width: 640, height: 512 };
    const withWindow = inkSurfaceViewport({ rect, page: PAGE, devicePixelRatio: 1, window });
    expect(withWindow?.viewport.visible).toEqual(window);

    const withBoth = inkSurfaceViewport({
      rect,
      page: PAGE,
      devicePixelRatio: 1,
      window,
      frame: { pageX: -300, pageY: -100, frameWidth: 200, frameHeight: 150 },
    });
    expect(withBoth?.viewport.visible).toEqual({ left: 300, top: 100, width: 200, height: 150 });
  });

  it("falls back to the sheet's near corner when the sheet is wholly outside the frame", () => {
    const result = inkSurfaceViewport({
      rect: { left: 2000, top: 0, width: 450, height: 620 },
      page: PAGE,
      devicePixelRatio: 1,
      frame: { pageX: 2000, pageY: 0, frameWidth: 300, frameHeight: 400 },
    });
    expect(result?.viewport.visible).toEqual({ left: 0, top: 0, width: 300, height: 400 });
  });

  it("ignores a frame that has no size yet", () => {
    const result = inkSurfaceViewport({
      rect: { left: 0, top: 0, width: 450, height: 620 },
      page: PAGE,
      devicePixelRatio: 1,
      frame: { pageX: 0, pageY: 0, frameWidth: 0, frameHeight: 0 },
    });
    expect(result?.viewport.visible).toEqual({ left: 0, top: 0, width: 450, height: 620 });
  });

  it("answers null while nothing is laid out, and defaults a bad density to 1", () => {
    expect(inkSurfaceViewport({ rect: { left: 0, top: 0, width: 0, height: 0 }, page: PAGE, devicePixelRatio: 1 })).toBeNull();
    expect(
      inkSurfaceViewport({ rect: { left: 0, top: 0, width: 450, height: 620 }, page: { width: 0, height: 0 }, devicePixelRatio: 1 })
    ).toBeNull();
    const result = inkSurfaceViewport({
      rect: { left: 0, top: 0, width: 450, height: 620 },
      page: PAGE,
      devicePixelRatio: Number.NaN,
    });
    expect(result?.viewport.devicePixelRatio).toBe(1);
  });
});

describe("inkClientToPage", () => {
  it("maps client pixels onto the page: relative to the corner, per unit", () => {
    expect(inkClientToPage({ left: 100, top: 50, scale: 2 }, 120, 90)).toEqual({ x: 10, y: 20 });
    expect(inkClientToPage({ left: -500, top: -300, scale: 3 }, 100, 0)).toEqual({ x: 200, y: 100 });
  });
});

describe("inkScribbleInPageUnits", () => {
  it("brings the hull onto the page with its box, and leaves the extent in screen pixels", () => {
    const result = inkScribbleInPageUnits(
      {
        band: {
          hull: [
            { x: 120, y: 90 },
            { x: 220, y: 90 },
            { x: 220, y: 190 },
            { x: 120, y: 190 },
          ],
        },
        majorExtent: 80,
      },
      { left: 100, top: 50, scale: 2 }
    );
    expect(result).toEqual({
      band: {
        hull: [
          { x: 10, y: 20 },
          { x: 60, y: 20 },
          { x: 60, y: 70 },
          { x: 10, y: 70 },
        ],
        bounds: { minX: 10, minY: 20, maxX: 60, maxY: 70 },
      },
      majorExtent: 80,
    });
  });

  it("answers null for an empty hull", () => {
    expect(inkScribbleInPageUnits({ band: { hull: [] }, majorExtent: 1 }, { left: 0, top: 0, scale: 1 })).toBeNull();
  });
});
