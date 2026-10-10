import { describe, expect, it } from "vitest";
import { importLegacyStrokes } from "@/lib/ink/import-legacy-strokes";
import { parseInkColor } from "@/lib/ink/color";
import { inkItemLayer } from "@/lib/ink/model";
import { getNotebookInkColor } from "@/lib/workspace/notebook-ink-data";
import type { NotebookStroke } from "@/lib/workspace/notebooks";

function stroke(tool: NotebookStroke["tool"], color: NotebookStroke["color"], width: number): NotebookStroke {
  return {
    tool,
    color,
    width,
    points: [
      { x: 10, y: 20 },
      { x: 60.256, y: 40 },
      { x: 110, y: 20 },
    ],
  };
}

describe("importLegacyStrokes", () => {
  it("imports pen and highlighter strokes with their layers, colours and round caps", () => {
    const result = importLegacyStrokes({
      version: 1,
      strokes: [stroke("pen", "red", 3), stroke("highlighter", "yellow", 18), stroke("pen", "#123456", 2)],
    });
    expect(result.unsupported).toEqual([]);
    const [pen, highlighter, custom] = result.document.items;
    if (pen.kind !== "outline" || highlighter.kind !== "outline" || custom.kind !== "outline") {
      throw new Error("expected outlines");
    }

    expect(pen.layer).toBe("pen");
    expect(pen.paint.fill).toBeNull();
    expect(pen.paint.opacity).toBe(1);
    expect(pen.paint.stroke).toMatchObject({ width: 3, cap: "round", join: "round" });
    expect(pen.paint.stroke?.color).toEqual(parseInkColor(getNotebookInkColor("red", "pen").color));

    expect(highlighter.layer).toBe("highlighter");
    expect(highlighter.paint.opacity).toBeCloseTo(getNotebookInkColor("yellow", "highlighter").opacity, 9);
    expect(highlighter.paint.stroke).toMatchObject({ width: 18, cap: "round", join: "round" });
    expect(highlighter.paint.stroke?.color).toEqual(
      parseInkColor(getNotebookInkColor("yellow", "highlighter").color)
    );

    expect(custom.paint.stroke?.color).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 1 });
  });

  it("reads the points as the conversion writes them, in order", () => {
    const [item] = importLegacyStrokes({ version: 1, strokes: [stroke("pen", "black", 2)] }).document.items;
    if (item.kind !== "outline") throw new Error("expected an outline");
    expect(item.path).toEqual([
      { op: "M", x: 10, y: 20 },
      { op: "L", x: 60.26, y: 40 },
      { op: "L", x: 110, y: 20 },
    ]);
  });

  it("gives an empty document for no strokes, and drops strokes with no points", () => {
    expect(importLegacyStrokes({ version: 1, strokes: [] }).document.items).toEqual([]);
    const empty: NotebookStroke = { tool: "pen", color: "black", width: 2, points: [] };
    expect(importLegacyStrokes({ version: 1, strokes: [empty] }).document.items).toEqual([]);
  });

  it("numbers items in stroke order", () => {
    const result = importLegacyStrokes({
      version: 1,
      strokes: [stroke("highlighter", "pink", 14), stroke("pen", "black", 2)],
    });
    expect(result.document.items.map(inkItemLayer)).toEqual(["highlighter", "pen"]);
    expect(result.document.items.map((item) => item.id)).toEqual(["s0", "s1"]);
  });
});
