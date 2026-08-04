import { describe, expect, it } from "vitest";
import {
  applyNotebookNibThickness,
  getNotebookNibThicknessForViewport,
  type NotebookInkStyle,
} from "@/lib/workspace/notebook-js-draw";

/**
 * js-draw lays down `thickness / viewport.getScaleFactor()`, treating tool
 * thickness as screen pixels. Handing it a page-unit width therefore made the
 * pen draw narrower the further in you zoomed: write at 2x, zoom back out, and
 * the writing was half the weight and looked shrunken. It also made the pen a
 * different weight on a phone than on a desktop, because the fitted scale
 * differs. These pin the mark to the page instead.
 */

class FakePen {
  thickness = 0;
  constructor(public readonly kind = "pen") {}
  getThickness() {
    return this.thickness;
  }
  setThickness(thickness: number) {
    this.thickness = thickness;
  }
}

function makeEditor(scaleFactor: number, pen = new FakePen()) {
  return {
    editor: {
      toolController: {
        getMatchingTools: () => [pen],
      },
      viewport: { getScaleFactor: () => scaleFactor },
    },
    jsDraw: { PenTool: FakePen },
    pen,
  };
}

const style = (
  overrides: Partial<NotebookInkStyle> = {}
): NotebookInkStyle => ({
  activeTool: "pen",
  eraserMode: "precision",
  eraserThickness: 40,
  highlighterColor: "yellow",
  highlighterThickness: 24,
  penColor: "black",
  penThickness: 6,
  ...overrides,
});

/** What js-draw will actually lay down, in page units. */
const widthOnPage = (thickness: number, scaleFactor: number) =>
  thickness / scaleFactor;

describe("getNotebookNibThicknessForViewport", () => {
  it.each([0.5, 0.78, 1, 1.7, 4])(
    "puts the same width on the page at %sx",
    (scaleFactor) => {
      const { editor } = makeEditor(scaleFactor);
      const thickness = getNotebookNibThicknessForViewport(editor as never, 6);

      expect(widthOnPage(thickness, scaleFactor)).toBeCloseTo(6, 10);
    }
  );

  it("survives a viewport that reports nothing usable", () => {
    for (const scaleFactor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { editor } = makeEditor(scaleFactor);
      expect(getNotebookNibThicknessForViewport(editor as never, 6)).toBe(6);
    }
  });
});

describe("applyNotebookNibThickness", () => {
  it("keeps the pen's page width fixed as the zoom changes", () => {
    const pen = new FakePen();
    for (const scaleFactor of [0.78, 1, 2.5]) {
      const { editor, jsDraw } = makeEditor(scaleFactor, pen);
      applyNotebookNibThickness(editor as never, style(), jsDraw as never);

      expect(widthOnPage(pen.thickness, scaleFactor)).toBeCloseTo(6, 10);
    }
  });

  it("does the same for the highlighter, using its own width", () => {
    const pen = new FakePen();
    const { editor, jsDraw } = makeEditor(2, pen);
    applyNotebookNibThickness(
      editor as never,
      style({ activeTool: "highlighter" }),
      jsDraw as never
    );

    expect(widthOnPage(pen.thickness, 2)).toBeCloseTo(24, 10);
  });

  it.each(["eraser", "select", "text"] as const)(
    "leaves the nib alone while the %s tool is active",
    (activeTool) => {
      const pen = new FakePen();
      pen.thickness = 99;
      const { editor, jsDraw } = makeEditor(2, pen);
      applyNotebookNibThickness(
        editor as never,
        style({ activeTool }),
        jsDraw as never
      );

      expect(pen.thickness).toBe(99);
    }
  );
});
