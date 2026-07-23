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
  it("centres complete grid cells instead of clipping the final column", () => {
    const lines = getNotebookCompleteGridLines(900);

    expect(lines).toHaveLength(21);
    expect(lines[0]).toBe(0);
    expect(lines.at(-1)).toBe(900);
    expect(
      lines.slice(1).every((line, index) => line - lines[index] === 45)
    ).toBe(true);
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
