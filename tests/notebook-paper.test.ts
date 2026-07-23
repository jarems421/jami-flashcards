import { describe, expect, it } from "vitest";
import {
  getNotebookCompleteGridLines,
  getNotebookRuledLines,
} from "@/lib/workspace/notebook-paper";

describe("notebook paper geometry", () => {
  it("centres complete grid cells instead of clipping the final column", () => {
    const lines = getNotebookCompleteGridLines(900);

    expect(lines).toHaveLength(23);
    expect(lines[0]).toBe(10);
    expect(lines.at(-1)).toBe(890);
    expect(
      lines.slice(1).every((line, index) => line - lines[index] === 40)
    ).toBe(true);
  });

  it("keeps ruled spacing in fixed notebook coordinates", () => {
    const lines = getNotebookRuledLines(1240);

    expect(lines[0]).toBe(40);
    expect(lines.at(-1)).toBe(1200);
    expect(lines).toHaveLength(30);
  });
});
