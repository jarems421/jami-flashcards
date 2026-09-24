import { describe, expect, it } from "vitest";
import {
  NOTEBOOK_TEXT_FONT_SIZE,
  NOTEBOOK_TEXT_STYLE,
  getNotebookTextBlockBodyHeight,
  getNotebookTextBlockFitHeight,
  notebookPageUnits,
} from "@/lib/workspace/notebook-text-metrics";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";

describe("notebook text metrics", () => {
  it("sizes type from the page's width, so it scales with the page", () => {
    expect(notebookPageUnits(NOTEBOOK_PAGE_COORDINATE_WIDTH)).toBe("100cqw");
    expect(notebookPageUnits(90)).toBe("10cqw");
    expect(NOTEBOOK_TEXT_STYLE.fontSize).toBe(
      notebookPageUnits(NOTEBOOK_TEXT_FONT_SIZE)
    );
  });

  it("gives a box's text its stored height, less the border round it", () => {
    expect(getNotebookTextBlockBodyHeight({ height: 90 })).toBe(
      "calc(10cqw - 2px)"
    );
  });

  describe("fitting a box to its text", () => {
    // A page drawn at 450px wide: half size, so one CSS px is two page units.
    const halfSize = { pageWidthPx: 450 };

    it("grows a box whose text runs past its foot, in page units", () => {
      expect(
        getNotebookTextBlockFitHeight({
          block: { y: 100, height: 96 },
          contentHeightPx: 79,
          visibleHeightPx: 46,
          ...halfSize,
        })
      ).toBe(162); // (79 + 2px border) x 2
    });

    it("leaves alone a box whose text fits", () => {
      expect(
        getNotebookTextBlockFitHeight({
          block: { y: 100, height: 96 },
          contentHeightPx: 46,
          visibleHeightPx: 46,
          ...halfSize,
        })
      ).toBeNull();
    });

    it("never grows on rounding alone, which would grow it for ever", () => {
      // A text area taller than its text reports its own height as the
      // content height; sub-pixel layout must not read as overflow.
      expect(
        getNotebookTextBlockFitHeight({
          block: { y: 100, height: 96 },
          contentHeightPx: 46.8,
          visibleHeightPx: 46,
          ...halfSize,
        })
      ).toBeNull();
    });

    it("never shrinks a box as text is deleted", () => {
      expect(
        getNotebookTextBlockFitHeight({
          block: { y: 100, height: 400 },
          contentHeightPx: 60,
          visibleHeightPx: 40,
          ...halfSize,
        })
      ).toBeNull();
    });

    it("stops at the foot of the page instead of moving the box up", () => {
      const y = NOTEBOOK_PAGE_COORDINATE_HEIGHT - 120;
      expect(
        getNotebookTextBlockFitHeight({
          block: { y, height: 96 },
          contentHeightPx: 300,
          visibleHeightPx: 46,
          ...halfSize,
        })
      ).toBe(120);
      // Already at the foot, there is nothing to grow into.
      expect(
        getNotebookTextBlockFitHeight({
          block: { y, height: 120 },
          contentHeightPx: 300,
          visibleHeightPx: 59,
          ...halfSize,
        })
      ).toBeNull();
    });

    it("measures nothing on a page that has not been laid out", () => {
      expect(
        getNotebookTextBlockFitHeight({
          block: { y: 100, height: 96 },
          contentHeightPx: 300,
          visibleHeightPx: 46,
          pageWidthPx: 0,
        })
      ).toBeNull();
    });
  });
});
