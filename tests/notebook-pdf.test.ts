import { describe, expect, it } from "vitest";
import {
  buildUploadedNotebookPageMappings,
  getNotebookPdfRenderMetrics,
  resolveNotebookPageBackgroundFileId,
  validateNotebookPdfPageCount,
} from "@/lib/workspace/notebook-pdf";

describe("notebook PDF helpers", () => {
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
