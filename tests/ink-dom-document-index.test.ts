import { describe, expect, it } from "vitest";
import { inkAddChange, inkRemoveChange, applyInkChange, invertInkChange } from "@/lib/ink/history";
import type { InkDocument, InkItem, InkLayer } from "@/lib/ink/model";
import { InkDocumentIndex } from "@/lib/ink-dom/document-index";

const black = { r: 0, g: 0, b: 0, a: 1 };

function line(id: string, layer: InkLayer, x: number, y: number): InkItem {
  return {
    kind: "outline",
    id,
    layer,
    path: [
      { op: "M", x, y },
      { op: "L", x: x + 10, y },
    ],
    paint: { fill: null, stroke: { color: black, width: 2, cap: "round", join: "round" }, opacity: 1 },
  };
}

const everywhere = { minX: -1000, minY: -1000, maxX: 2000, maxY: 2000 };
const ids = (items: InkItem[]) => items.map((item) => item.id);

describe("InkDocumentIndex", () => {
  const doc: InkDocument = {
    version: 3,
    items: [
      line("a", "pen", 0, 0),
      line("h1", "highlighter", 0, 0),
      line("b", "pen", 500, 500),
      line("c", "pen", 5, 0),
      { kind: "unknown", id: "u", layerCode: 1, code: 9, payload: new Uint8Array([1]) },
    ],
  };

  it("answers by layer, in drawing order, and only nearby items", () => {
    const index = new InkDocumentIndex();
    index.reset(doc);
    expect(ids(index.query("pen", everywhere))).toEqual(["a", "b", "c"]);
    expect(ids(index.query("highlighter", everywhere))).toEqual(["h1"]);
    expect(ids(index.query("pen", { minX: 0, minY: -5, maxX: 20, maxY: 5 }))).toEqual(["a", "c"]);
  });

  it("knows a change that only adds on top of the page", () => {
    const index = new InkDocumentIndex();
    index.reset(doc);
    const added = line("d", "pen", 2, 0);
    const change = inkAddChange(doc, [added]);
    const next = applyInkChange(doc, change);
    expect(index.apply(next, change)).toEqual({ onTop: true });
    expect(ids(index.query("pen", { minX: 0, minY: -5, maxX: 20, maxY: 5 }))).toEqual(["a", "c", "d"]);
  });

  it("keeps the order right when an item comes back in the middle", () => {
    const index = new InkDocumentIndex();
    index.reset(doc);
    const erase = inkRemoveChange(doc, ["a"]);
    const erased = applyInkChange(doc, erase);
    expect(index.apply(erased, erase)).toEqual({ onTop: false });
    expect(ids(index.query("pen", everywhere))).toEqual(["b", "c"]);
    const undo = invertInkChange(erase);
    const restored = applyInkChange(erased, undo);
    expect(index.apply(restored, undo)).toEqual({ onTop: false });
    expect(ids(index.query("pen", everywhere))).toEqual(["a", "b", "c"]);
  });
});
