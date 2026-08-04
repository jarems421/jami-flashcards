import { describe, expect, it } from "vitest";
import {
  getNotebookCompleteGridLines,
  getNotebookRuledLines,
} from "@/lib/workspace/notebook-paper";
import {
  isNotebookPageStyle,
  NOTEBOOK_CREATION_PAGE_STYLES,
} from "@/lib/workspace/notebooks";

describe("notebook paper geometry", () => {
  it("divides the page's width into whole cells", () => {
    const lines = getNotebookCompleteGridLines(900);

    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe(0);
    expect(lines.at(-1)).toBe(900);
    expect(
      lines.slice(1).every((line, index) => line - lines[index] === 45)
    ).toBe(true);
  });

  /**
   * The page is 1240 tall against a 45 cell, which does not divide. The spacing
   * used to be kept exact and the twenty-five unit remainder split between the
   * two ends, leaving a band about a quarter of a cell tall at the top and the
   * bottom -- the row of half-squares. The spacing gives way instead.
   */
  it("leaves no half-cell at the top or bottom of a page that does not divide", () => {
    const lines = getNotebookCompleteGridLines(1240);

    expect(lines[0]).toBe(0);
    expect(lines.at(-1)).toBe(1240);

    const gaps = lines.slice(1).map((line, index) => line - lines[index]);
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0], 10);
    }
  });

  it("stays near enough to square to read as squared paper", () => {
    const across = getNotebookCompleteGridLines(900);
    const down = getNotebookCompleteGridLines(1240);
    const cellWidth = across[1] - across[0];
    const cellHeight = down[1] - down[0];

    // Under two per cent apart at the notebook's own size.
    expect(Math.abs(cellHeight / cellWidth - 1)).toBeLessThan(0.02);
  });

  it("still draws a single cell on a page too small to fit one", () => {
    const lines = getNotebookCompleteGridLines(20);

    expect(lines).toEqual([0, 20]);
  });

  it("keeps ruled spacing in fixed notebook coordinates", () => {
    const lines = getNotebookRuledLines(1240);

    expect(lines[0]).toBe(40);
    expect(lines.at(-1)).toBe(1200);
    expect(lines).toHaveLength(30);
  });

  it("offers only the three clean creation styles without breaking old dotted pages", () => {
    expect(NOTEBOOK_CREATION_PAGE_STYLES).toEqual([
      "plain",
      "lined",
      "grid",
    ]);
    expect(isNotebookPageStyle("dot")).toBe(true);
  });
});
