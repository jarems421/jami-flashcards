import { describe, expect, it } from "vitest";
import {
  assertImportedNotebookPageCount,
  buildUploadedNotebookPageMappings,
  getNotebookPdfCanvasPlacement,
  getNotebookPdfDetailRender,
  getNotebookPdfRenderMetrics,
  MAX_NOTEBOOK_PDF_DETAIL_PIXELS,
  sameNotebookPdfDetailRender,
  resolveNotebookPageBackgroundFileId,
  shouldRerenderNotebookPdfCanvas,
  validateOwnedNotebookPdfStoragePath,
  validateNotebookPdfPageIndex,
  validateNotebookPdfPageCount,
} from "@/lib/workspace/notebook-pdf";

describe("notebook PDF helpers", () => {
  it("only permits notebook PDF paths owned by the signed-in user", () => {
    expect(
      validateOwnedNotebookPdfStoragePath(
        "users/alice/notebookFiles/notebook-1/paper.pdf",
        "alice"
      )
    ).toBe("users/alice/notebookFiles/notebook-1/paper.pdf");
    expect(() =>
      validateOwnedNotebookPdfStoragePath(
        "users/bob/notebookFiles/notebook-1/paper.pdf",
        "alice"
      )
    ).toThrow("Invalid notebook PDF path");
    expect(() =>
      validateOwnedNotebookPdfStoragePath(
        "users/alice/notebookFiles/../paper.pdf",
        "alice"
      )
    ).toThrow("Invalid notebook PDF path");
    expect(() =>
      validateOwnedNotebookPdfStoragePath(
        "users/alice/notebookFiles/notebook-1/nested/paper.pdf",
        "alice"
      )
    ).toThrow("Invalid notebook PDF path");
  });

  it("accepts one and two hundred pages and rejects larger documents", () => {
    expect(validateNotebookPdfPageCount(1)).toBe(1);
    expect(validateNotebookPdfPageCount(200)).toBe(200);
    expect(() => validateNotebookPdfPageCount(201)).toThrow(
      "support up to 200 pages"
    );
  });

  it("builds zero-based PDF mappings and a single image mapping", () => {
    expect(
      buildUploadedNotebookPageMappings({
        pageCount: 2,
        fileId: "file-1",
        isPdf: true,
      })
    ).toEqual([
      {
        pageNumber: 1,
        title: "Page 1",
        backgroundFileId: "file-1",
        pdfPageIndex: 0,
      },
      {
        pageNumber: 2,
        title: "Page 2",
        backgroundFileId: "file-1",
        pdfPageIndex: 1,
      },
    ]);
    expect(
      buildUploadedNotebookPageMappings({
        pageCount: 1,
        fileId: "image-1",
        isPdf: false,
      })[0]?.pdfPageIndex
    ).toBeUndefined();
  });

  it("rejects page indexes outside the uploaded PDF", () => {
    expect(validateNotebookPdfPageIndex(0, 2)).toBe(0);
    expect(validateNotebookPdfPageIndex(1, 2)).toBe(1);
    expect(() => validateNotebookPdfPageIndex(2, 2)).toThrow(
      "page 3 is unavailable"
    );
    expect(() => validateNotebookPdfPageIndex(-1, 2)).toThrow(
      "page 0 is unavailable"
    );
  });

  it("requires every detected page to have a created notebook page", () => {
    expect(() => assertImportedNotebookPageCount(2, 2)).not.toThrow();
    expect(() => assertImportedNotebookPageCount(2, 1)).toThrow(
      "Expected 2 imported pages, but created 1"
    );
  });

  it("fits a page within its host and caps high-DPI rendering", () => {
    expect(
      getNotebookPdfRenderMetrics({
        pageWidth: 600,
        pageHeight: 800,
        hostWidth: 300,
        hostHeight: 500,
        pixelRatio: 3,
      })
    ).toEqual({
      cssScale: 0.5,
      pixelRatio: 2,
      canvasWidth: 600,
      canvasHeight: 800,
      cssWidth: 300,
      cssHeight: 400,
    });
  });

  it("caps the total canvas allocation at high zoom on Retina screens", () => {
    const metrics = getNotebookPdfRenderMetrics({
      pageWidth: 900,
      pageHeight: 1240,
      hostWidth: 3_600,
      hostHeight: 4_960,
      pixelRatio: 2,
      maxCanvasPixels: 6_000_000,
    });

    expect(metrics.canvasWidth * metrics.canvasHeight).toBeLessThanOrEqual(
      6_000_000
    );
    expect(metrics.pixelRatio).toBeLessThan(1);
    expect(metrics.cssWidth).toBe(3_600);
    expect(metrics.cssHeight).toBe(4_960);
  });

  it("falls back to legacy uploaded-file notebooks at PDF page zero", () => {
    expect(
      resolveNotebookPageBackgroundFileId({
        notebookUploadedFileId: "legacy-file",
        firstFileId: "first-file",
      })
    ).toBe("legacy-file");
    expect(
      resolveNotebookPageBackgroundFileId({
        pageBackgroundFileId: "mapped-file",
        notebookUploadedFileId: "legacy-file",
        hasMappedPages: true,
      })
    ).toBe("mapped-file");
    expect(
      resolveNotebookPageBackgroundFileId({
        notebookUploadedFileId: "mapped-notebook-file",
        hasMappedPages: true,
      })
    ).toBeUndefined();
  });

  it("only redraws a PDF page on screen when it needs more pixels", () => {
    const fit = getNotebookPdfRenderMetrics({
      pageWidth: 595,
      pageHeight: 842,
      hostWidth: 816,
      hostHeight: 1124,
      pixelRatio: 2,
    });
    const zoomedTwice = getNotebookPdfRenderMetrics({
      pageWidth: 595,
      pageHeight: 842,
      hostWidth: 816 * 2,
      hostHeight: 1124 * 2,
      pixelRatio: 2,
    });
    const zoomedFourTimes = getNotebookPdfRenderMetrics({
      pageWidth: 595,
      pageHeight: 842,
      hostWidth: 816 * 4,
      hostHeight: 1124 * 4,
      pixelRatio: 2,
    });
    const shownAt = (metrics: typeof fit) => ({
      width: metrics.canvasWidth,
      height: metrics.canvasHeight,
    });

    // Nothing on screen yet: draw.
    expect(shouldRerenderNotebookPdfCanvas({ current: null, next: fit })).toBe(true);
    // The first zoom past fit needs more pixels.
    expect(
      shouldRerenderNotebookPdfCanvas({ current: shownAt(fit), next: zoomedTwice })
    ).toBe(true);
    // Past the pixel ceiling a deeper zoom asks for the same canvas again,
    // which used to be redrawn from scratch every time.
    expect(
      shouldRerenderNotebookPdfCanvas({
        current: shownAt(zoomedTwice),
        next: zoomedFourTimes,
      })
    ).toBe(false);
    // Zooming back out is scaled down, not redrawn...
    expect(
      shouldRerenderNotebookPdfCanvas({ current: shownAt(zoomedTwice), next: fit })
    ).toBe(false);
    // ...unless the canvas is over twice the size needed, where it shimmers.
    expect(
      shouldRerenderNotebookPdfCanvas({
        current: { width: fit.canvasWidth * 3, height: fit.canvasHeight * 3 },
        next: fit,
      })
    ).toBe(true);
    // Rounding is not a size change.
    expect(
      shouldRerenderNotebookPdfCanvas({
        current: { width: fit.canvasWidth - 1, height: fit.canvasHeight - 2 },
        next: fit,
      })
    ).toBe(false);
  });

  it("places a PDF canvas by percentage so it stretches with its host", () => {
    expect(
      getNotebookPdfCanvasPlacement({
        cssWidth: 400,
        cssHeight: 500,
        hostWidth: 500,
        hostHeight: 500,
      })
    ).toEqual({ width: 80, height: 100, left: 10, top: 0 });
    // Never larger than the host, even with a stale measurement.
    expect(
      getNotebookPdfCanvasPlacement({
        cssWidth: 900,
        cssHeight: 300,
        hostWidth: 600,
        hostHeight: 600,
      })
    ).toEqual({ width: 100, height: 50, left: 0, top: 25 });
  });
});

describe("the sharp slice over a zoomed PDF page", () => {
  // An A4 page on a 2x iPad, zoomed to 3x: the sheet is about 2400 x 3400.
  const page = { width: 595, height: 842 };
  const zoomed = getNotebookPdfRenderMetrics({
    pageWidth: page.width,
    pageHeight: page.height,
    hostWidth: 2400,
    hostHeight: 3396,
    pixelRatio: 2,
  });
  const screen = { left: 900, top: 1200, width: 834, height: 1112 };

  it("is needed because the whole page falls below the screen's density when zoomed", () => {
    expect(zoomed.pixelRatio).toBeLessThan(1);
  });

  it("draws the visible part at the screen's own density, within the budget", () => {
    const detail = getNotebookPdfDetailRender({
      window: screen,
      cssWidth: zoomed.cssWidth,
      cssHeight: zoomed.cssHeight,
      basePixelRatio: zoomed.pixelRatio,
      hostWidth: 2400,
      hostHeight: 3396,
      devicePixelRatio: 2,
    });
    expect(detail).not.toBeNull();
    expect(detail!.pixelRatio).toBe(2);
    expect(detail!.canvasWidth * detail!.canvasHeight).toBeLessThanOrEqual(MAX_NOTEBOOK_PDF_DETAIL_PIXELS);
    // Its corner is where the window starts, and the drawing starts there too.
    const pdfLeft = (2400 - zoomed.cssWidth) / 2;
    expect(detail!.left).toBe(screen.left);
    expect(detail!.offsetX).toBeCloseTo((screen.left - pdfLeft) * 2);
    // Sized from its own pixels, so each lands on one screen pixel.
    expect(detail!.width * detail!.pixelRatio).toBe(detail!.canvasWidth);
  });

  it("lowers its density rather than its area when the window is very large", () => {
    const detail = getNotebookPdfDetailRender({
      window: { left: 0, top: 0, width: 2400, height: 3396 },
      cssWidth: zoomed.cssWidth,
      cssHeight: zoomed.cssHeight,
      basePixelRatio: 0.5,
      hostWidth: 2400,
      hostHeight: 3396,
      devicePixelRatio: 3,
    });
    expect(detail!.pixelRatio).toBeLessThan(3);
    expect(detail!.canvasWidth * detail!.canvasHeight).toBeLessThanOrEqual(MAX_NOTEBOOK_PDF_DETAIL_PIXELS + 4000);
  });

  it("is not drawn when the whole page is already sharp, or nothing is on screen", () => {
    const fitted = getNotebookPdfRenderMetrics({
      pageWidth: page.width,
      pageHeight: page.height,
      hostWidth: 800,
      hostHeight: 1132,
      pixelRatio: 2,
    });
    const common = {
      cssWidth: fitted.cssWidth,
      cssHeight: fitted.cssHeight,
      basePixelRatio: fitted.pixelRatio,
      hostWidth: 800,
      hostHeight: 1132,
      devicePixelRatio: 2,
    };
    expect(getNotebookPdfDetailRender({ ...common, window: { left: 0, top: 0, width: 800, height: 1132 } })).toBeNull();
    expect(
      getNotebookPdfDetailRender({ ...common, basePixelRatio: 1, window: null })
    ).toBeNull();
    // A window entirely in the margin beside a narrow PDF draws nothing.
    expect(
      getNotebookPdfDetailRender({
        ...common,
        basePixelRatio: 1,
        cssWidth: 400,
        window: { left: 0, top: 0, width: 150, height: 500 },
      })
    ).toBeNull();
  });

  it("treats the same slice as unchanged, so a small pan redraws nothing", () => {
    const input = {
      window: screen,
      cssWidth: zoomed.cssWidth,
      cssHeight: zoomed.cssHeight,
      basePixelRatio: zoomed.pixelRatio,
      hostWidth: 2400,
      hostHeight: 3396,
      devicePixelRatio: 2,
    };
    expect(sameNotebookPdfDetailRender(getNotebookPdfDetailRender(input), getNotebookPdfDetailRender(input))).toBe(true);
    expect(
      sameNotebookPdfDetailRender(
        getNotebookPdfDetailRender(input),
        getNotebookPdfDetailRender({ ...input, window: { ...screen, left: 964 } })
      )
    ).toBe(false);
  });
});
