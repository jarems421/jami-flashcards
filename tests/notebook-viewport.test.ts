import { describe, expect, it } from "vitest";
import {
  clampNotebookViewportOrigin,
  getNotebookInkViewportScale,
  getNotebookViewportLayout,
  getNotebookViewportPanBounds,
  getNotebookViewportPreferredZoom,
  getNotebookViewportZoomAfterPreferredSizeChange,
  NOTEBOOK_VIEWPORT_MAX_ZOOM,
  NOTEBOOK_VIEWPORT_MIN_ZOOM,
} from "@/lib/workspace/notebook-viewport";

describe("notebook viewport layout", () => {
  it("fits the fixed 900 by 1240 page inside an iPad portrait frame", () => {
    const layout = getNotebookViewportLayout({
      frameWidth: 768,
      frameHeight: 956,
    });

    expect(layout.logicalPageSize).toEqual({ width: 900, height: 1240 });
    expect(layout.inset).toBe(16);
    expect(layout.availableSize).toEqual({ width: 736, height: 924 });
    expect(layout.fitSize.width).toBeCloseTo(670.6451612903226);
    expect(layout.fitSize.height).toBe(924);
    expect(layout.fitScale).toBeCloseTo(924 / 1240);
    expect(layout.fitOrigin.x).toBeCloseTo((768 - layout.fitSize.width) / 2);
    expect(layout.fitOrigin.y).toBe(16);
    expect(layout.pageOrigin).toEqual(layout.fitOrigin);
    expect(layout.swipeTravel).toBeCloseTo(layout.pageSize.width + 16);
  });

  it("keeps the true full-page fit while enlarging the preferred iPad landscape view", () => {
    const preferredZoom = getNotebookViewportPreferredZoom({
      frameWidth: 1024,
      frameHeight: 700,
    });
    const layout = getNotebookViewportLayout({
      frameWidth: 1024,
      frameHeight: 700,
      zoom: preferredZoom,
    });

    expect(layout.inset).toBe(16);
    expect(layout.fitSize.width).toBeCloseTo((668 * 900) / 1240);
    expect(layout.fitSize.height).toBe(668);
    expect(preferredZoom).toBeCloseTo(1240 / 900);
    expect(layout.pageSize.width).toBeCloseTo(668);
    expect(layout.pageSize.height).toBeCloseTo((668 * 1240) / 900);
    expect(layout.pageOrigin.x).toBeCloseTo(
      (1024 - layout.pageSize.width) / 2
    );
    expect(layout.pageOrigin.y).toBeCloseTo(
      (700 - layout.pageSize.height) / 2
    );
    expect(layout.pageSize.width / layout.pageSize.height).toBeCloseTo(
      900 / 1240
    );
  });

  it("keeps portrait framing unchanged and preserves relative zoom across rotation", () => {
    const portraitPreferredZoom = getNotebookViewportPreferredZoom({
      frameWidth: 768,
      frameHeight: 956,
    });
    const landscapePreferredZoom = getNotebookViewportPreferredZoom({
      frameWidth: 1024,
      frameHeight: 700,
    });

    expect(portraitPreferredZoom).toBe(1);
    expect(
      getNotebookViewportZoomAfterPreferredSizeChange({
        zoom: 1,
        previousPreferredZoom: portraitPreferredZoom,
        nextPreferredZoom: landscapePreferredZoom,
      })
    ).toBeCloseTo(landscapePreferredZoom);
    expect(
      getNotebookViewportZoomAfterPreferredSizeChange({
        zoom: landscapePreferredZoom,
        previousPreferredZoom: landscapePreferredZoom,
        nextPreferredZoom: portraitPreferredZoom,
      })
    ).toBe(1);
  });

  it("still allows the complete landscape page at fit and minimum zoom", () => {
    const fitted = getNotebookViewportLayout({
      frameWidth: 1024,
      frameHeight: 700,
      zoom: 1,
    });
    const minimum = getNotebookViewportLayout({
      frameWidth: 1024,
      frameHeight: 700,
      zoom: NOTEBOOK_VIEWPORT_MIN_ZOOM,
    });

    expect(fitted.pageSize).toEqual(fitted.fitSize);
    expect(fitted.fitOrigin.y).toBe(16);
    expect(minimum.pageSize.width).toBeLessThan(fitted.pageSize.width);
    expect(minimum.pageSize.height).toBeLessThan(fitted.pageSize.height);
  });

  it("uses 12px fit insets on compact phone frames", () => {
    const layout = getNotebookViewportLayout({
      frameWidth: 390,
      frameHeight: 776,
    });

    expect(layout.inset).toBe(12);
    expect(layout.availableSize).toEqual({ width: 366, height: 752 });
    expect(layout.fitSize).toEqual({
      width: 366,
      height: (366 * 1240) / 900,
    });
    expect(layout.fitOrigin.x).toBe(12);
    expect(layout.fitOrigin.y).toBeCloseTo(
      (776 - layout.fitSize.height) / 2
    );
  });

  it("centres the complete sheet with extra workspace at 92 percent", () => {
    const layout = getNotebookViewportLayout({
      frameWidth: 768,
      frameHeight: 956,
      zoom: 0,
      pan: { x: -500, y: 900 },
    });

    expect(layout.zoom).toBe(NOTEBOOK_VIEWPORT_MIN_ZOOM);
    expect(layout.pageSize.width).toBeCloseTo(layout.fitSize.width * 0.92);
    expect(layout.pageSize.height).toBeCloseTo(layout.fitSize.height * 0.92);
    expect(layout.pageOrigin.x).toBeCloseTo(
      (layout.frameSize.width - layout.pageSize.width) / 2
    );
    expect(layout.pageOrigin.y).toBeCloseTo(
      (layout.frameSize.height - layout.pageSize.height) / 2
    );
    expect(layout.pageOrigin.y).toBeCloseTo(
      layout.frameSize.height - layout.pageSize.height - layout.pageOrigin.y
    );
  });

  it("caps zoom at 400 percent and clamps oversized page pan", () => {
    const layout = getNotebookViewportLayout({
      frameWidth: 768,
      frameHeight: 956,
      zoom: 20,
      pan: { x: 200, y: -10_000 },
    });

    expect(layout.zoom).toBe(NOTEBOOK_VIEWPORT_MAX_ZOOM);
    expect(layout.pageSize.width).toBeCloseTo(layout.fitSize.width * 4);
    expect(layout.pageSize.height).toBeCloseTo(layout.fitSize.height * 4);
    expect(layout.panBounds).toEqual({
      minX: 768 - layout.pageSize.width,
      maxX: 0,
      minY: 956 - layout.pageSize.height,
      maxY: 0,
    });
    expect(layout.pageOrigin.x).toBe(0);
    expect(layout.pageOrigin.y).toBe(layout.panBounds.minY);
  });

  it("preserves the fixed page aspect ratio at every supported zoom", () => {
    for (const zoom of [0.92, 1, 4]) {
      const layout = getNotebookViewportLayout({
        frameWidth: 1024,
        frameHeight: 700,
        zoom,
      });

      expect(layout.pageSize.width / layout.pageSize.height).toBeCloseTo(
        900 / 1240,
        12
      );
    }
  });

  it("recentres an undersized axis while preserving valid pan on the other axis", () => {
    const layout = getNotebookViewportLayout({
      frameWidth: 1024,
      frameHeight: 700,
      zoom: 2,
      pan: { x: -900, y: -200 },
    });

    expect(layout.pageSize.width).toBeLessThan(layout.frameSize.width);
    expect(layout.pageSize.height).toBeGreaterThan(layout.frameSize.height);
    expect(layout.pageOrigin.x).toBeCloseTo(
      (layout.frameSize.width - layout.pageSize.width) / 2
    );
    expect(layout.pageOrigin.y).toBe(-200);
  });

  it("derives one page-and-gap travel distance for every carousel sheet", () => {
    const fitted = getNotebookViewportLayout({
      frameWidth: 1200,
      frameHeight: 900,
    });
    const zoomed = getNotebookViewportLayout({
      frameWidth: 1200,
      frameHeight: 900,
      zoom: 2.5,
      swipeGap: 24,
    });

    expect(fitted.swipeGap).toBe(16);
    expect(fitted.swipeTravel).toBe(fitted.pageSize.width + 16);
    expect(zoomed.swipeGap).toBe(24);
    expect(zoomed.swipeTravel).toBe(zoomed.pageSize.width + 24);
  });

  it("provides deterministic centred bounds for an undersized page", () => {
    const bounds = getNotebookViewportPanBounds({
      pageWidth: 300,
      pageHeight: 400,
      frameWidth: 500,
      frameHeight: 600,
    });

    expect(bounds).toEqual({ minX: 100, maxX: 100, minY: 100, maxY: 100 });
    expect(
      clampNotebookViewportOrigin({
        origin: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
        bounds,
      })
    ).toEqual({ x: 100, y: 100 });
  });

  it("returns stable empty geometry before the frame is measured", () => {
    const layout = getNotebookViewportLayout({
      frameWidth: 0,
      frameHeight: Number.NaN,
    });

    expect(layout.frameSize).toEqual({ width: 0, height: 0 });
    expect(layout.fitSize).toEqual({ width: 0, height: 0 });
    expect(layout.fitScale).toBe(0);
    expect(layout.pageOrigin).toEqual({ x: 0, y: 0 });
    expect(layout.swipeTravel).toBe(16);
  });
});

describe("notebook ink viewport", () => {
  it("maps notebook coordinates to the full visible page without centred margins", () => {
    expect(
      getNotebookInkViewportScale({
        displayWidth: 450,
        displayHeight: 713,
        pageWidth: 900,
        pageHeight: 1240,
      })
    ).toEqual({
      x: 0.5,
      y: 713 / 1240,
    });
  });

  it("supports the portrait page stretch without adding an origin offset", () => {
    const scale = getNotebookInkViewportScale({
      displayWidth: 900,
      displayHeight: 1426,
      pageWidth: 900,
      pageHeight: 1240,
    });

    expect(scale.x).toBe(1);
    expect(scale.y).toBeCloseTo(1.15, 2);
  });
});
