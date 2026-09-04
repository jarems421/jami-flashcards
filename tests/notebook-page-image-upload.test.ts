import { describe, expect, it } from "vitest";
import {
  getNotebookPageImageDisplaySize,
  MAX_NOTEBOOK_PAGE_IMAGE_BYTES,
  validateNotebookPageImage,
} from "@/lib/workspace/notebook-page-image-upload";

describe("images placed on a notebook page", () => {
  it("takes the image formats the page can draw", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(() =>
        validateNotebookPageImage({ type, size: 1_000 })
      ).not.toThrow();
    }
  });

  it("refuses a PDF, which belongs in the notebook as its own page", () => {
    expect(() =>
      validateNotebookPageImage({ type: "application/pdf", size: 1_000 })
    ).toThrow(/JPEG, PNG, or WebP/);
  });

  it("refuses an empty or oversized file", () => {
    expect(() =>
      validateNotebookPageImage({ type: "image/png", size: 0 })
    ).toThrow(/empty/);
    expect(() =>
      validateNotebookPageImage({
        type: "image/png",
        size: MAX_NOTEBOOK_PAGE_IMAGE_BYTES + 1,
      })
    ).toThrow(/under 12 MB/);
  });
});

describe("sizing an image for the page", () => {
  it("fills the usual width and keeps the proportions", () => {
    const size = getNotebookPageImageDisplaySize({ width: 1600, height: 900 });

    expect(size.width).toBe(520);
    expect(size.width / size.height).toBeCloseTo(1600 / 900, 1);
  });

  it("bounds a tall image by height so it does not overrun the page", () => {
    const size = getNotebookPageImageDisplaySize({ width: 900, height: 1600 });

    expect(size.height).toBeLessThanOrEqual(620);
    expect(size.width).toBeLessThan(520);
    expect(size.width / size.height).toBeCloseTo(900 / 1600, 1);
  });

  it("falls back to a sane shape when the dimensions are unknown", () => {
    const size = getNotebookPageImageDisplaySize({ width: 0, height: 0 });

    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
    expect(size.width / size.height).toBeCloseTo(4 / 3, 1);
  });
});
