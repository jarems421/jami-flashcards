import { describe, expect, it } from "vitest";
import {
  assertImportedNotebookPageCount,
  buildUploadedNotebookPageMappings,
  getNotebookPdfRenderMetrics,
  resolveNotebookPageBackgroundFileId,
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
});
