import { describe, expect, it } from "vitest";
import {
  applyInkChange,
  inkAddChange,
  inkClearChange,
  inkDiffChange,
  InkHistory,
  inkRemoveChange,
  inkReplaceChange,
  invertInkChange,
} from "@/lib/ink/history";
import type { InkDocument } from "@/lib/ink/model";
import { MAX_NOTEBOOK_HISTORY_ENTRIES } from "@/lib/workspace/notebook-history";
import { docOf, lineShape } from "./support/ink-fixtures";

const item = (id: string) => lineShape(id, 0, 0, 10, 10);
const ids = (doc: InkDocument) => doc.items.map((i) => i.id);

describe("ink changes", () => {
  it("appends items", () => {
    const doc = docOf(item("a"));
    const change = inkAddChange(doc, [item("b"), item("c")]);
    expect(change.added.map((a) => a.index)).toEqual([1, 2]);
    expect(ids(applyInkChange(doc, change))).toEqual(["a", "b", "c"]);
  });

  it("removes by id and ignores unknown ids", () => {
    const doc = docOf(item("a"), item("b"), item("c"), item("d"));
    const change = inkRemoveChange(doc, ["b", "d", "nope"]);
    expect(ids(applyInkChange(doc, change))).toEqual(["a", "c"]);
  });

  it("replaces in place, keeping z order", () => {
    const doc = docOf(item("a"), item("b"), item("c"), item("d"));
    const change = inkReplaceChange(
      doc,
      new Map([
        ["b", [item("b1"), item("b2")]],
        ["d", []],
        ["a", [item("a1")]],
      ])
    );
    expect(ids(applyInkChange(doc, change))).toEqual(["a1", "b1", "b2", "c"]);
    expect(change.removed.map((r) => r.index)).toEqual([0, 1, 3]);
    expect(change.added.map((a) => [a.index, a.item.id])).toEqual([
      [0, "a1"],
      [1, "b1"],
      [2, "b2"],
    ]);
  });

  it("clears the page", () => {
    const doc = docOf(item("a"), item("b"));
    expect(applyInkChange(doc, inkClearChange(doc)).items).toEqual([]);
  });

  it("restores the exact document when inverted", () => {
    const doc = docOf(item("a"), item("b"), item("c"), item("d"), item("e"));
    const changes = [
      inkAddChange(doc, [item("f")]),
      inkRemoveChange(doc, ["a", "c", "e"]),
      inkReplaceChange(doc, new Map([["b", [item("b1"), item("b2"), item("b3")]], ["d", []]])),
      inkClearChange(doc),
    ];
    for (const change of changes) {
      const changed = applyInkChange(doc, change);
      const restored = applyInkChange(changed, invertInkChange(change));
      expect(restored).toEqual(doc);
      // Same item objects, so renderer caches keyed on them survive an undo.
      restored.items.forEach((restoredItem, index) => expect(restoredItem).toBe(doc.items[index]));
    }
  });

  it("does not mutate the document it is given", () => {
    const doc = docOf(item("a"), item("b"));
    applyInkChange(doc, inkClearChange(doc));
    expect(ids(doc)).toEqual(["a", "b"]);
  });

  it("throws when the document is not the one the change was made for", () => {
    const doc = docOf(item("a"), item("b"));
    const change = inkRemoveChange(doc, ["b"]);
    expect(() => applyInkChange(docOf(item("b"), item("a")), change)).toThrow(/expected item "b"/);
    expect(() => applyInkChange(docOf(item("a")), change)).toThrow();
    const twice = { removed: [change.removed[0], change.removed[0]], added: [] };
    expect(() => applyInkChange(doc, twice)).toThrow(/twice/);
    expect(() => applyInkChange(doc, { removed: [], added: [{ index: 9, item: item("z") }] })).toThrow(
      /cannot insert/
    );
  });
});

describe("inkDiffChange", () => {
  function expectRoundTrip(before: InkDocument, after: InkDocument) {
    const diff = inkDiffChange(before, after);
    expect(applyInkChange(before, diff)).toEqual(after);
    expect(applyInkChange(after, invertInkChange(diff))).toEqual(before);
    return diff;
  }

  it("is empty when nothing changed", () => {
    const doc = docOf(item("a"), item("b"));
    expect(inkDiffChange(doc, docOf(...doc.items))).toEqual({ removed: [], added: [] });
    expect(inkDiffChange(docOf(), docOf())).toEqual({ removed: [], added: [] });
  });

  it("records removals only", () => {
    const before = docOf(item("a"), item("b"), item("c"), item("d"));
    const after = docOf(before.items[0], before.items[2]);
    const diff = expectRoundTrip(before, after);
    expect(diff.removed.map((r) => [r.index, r.item.id])).toEqual([
      [1, "b"],
      [3, "d"],
    ]);
    expect(diff.added).toEqual([]);
  });

  it("records a split as one removal and its pieces in place", () => {
    const before = docOf(item("a"), item("b"), item("c"));
    const after = docOf(before.items[0], item("b1"), item("b2"), before.items[2]);
    const diff = expectRoundTrip(before, after);
    expect(diff.removed.map((r) => [r.index, r.item.id])).toEqual([[1, "b"]]);
    expect(diff.added.map((a) => [a.index, a.item.id])).toEqual([
      [1, "b1"],
      [2, "b2"],
    ]);
  });

  it("handles splits and removals together", () => {
    const before = docOf(item("a"), item("b"), item("c"), item("d"), item("e"));
    const after = docOf(item("a1"), item("a2"), before.items[2], item("e1"));
    const diff = expectRoundTrip(before, after);
    expect(diff.removed.map((r) => r.item.id)).toEqual(["a", "b", "d", "e"]);
    expect(diff.added.map((a) => a.item.id)).toEqual(["a1", "a2", "e1"]);
  });

  it("treats the same id on a different object as removed and added", () => {
    const before = docOf(item("a"), item("b"));
    const after = docOf(before.items[0], item("b"));
    const diff = expectRoundTrip(before, after);
    expect(diff.removed.map((r) => r.item.id)).toEqual(["b"]);
    expect(diff.added.map((a) => a.item.id)).toEqual(["b"]);
    expect(diff.added[0].item).toBe(after.items[1]);
  });

  it("records an erase gesture as one undo step", () => {
    const history = new InkHistory();
    const original = docOf(item("a"), item("b"), item("c"), item("d"));
    // Many per-packet edits...
    const step1 = applyInkChange(original, inkReplaceChange(original, new Map([["b", [item("b1"), item("b2")]]])));
    const step2 = applyInkChange(step1, inkRemoveChange(step1, ["c"]));
    const step3 = applyInkChange(step2, inkReplaceChange(step2, new Map([["b2", [item("b2x")]]])));
    // ...one change.
    history.push(inkDiffChange(original, step3));
    expect(history.undoDepth).toBe(1);

    const undone = history.undo(step3)!;
    expect(undone.doc).toEqual(original);
    undone.doc.items.forEach((restored, index) => expect(restored).toBe(original.items[index]));
    const redone = history.redo(undone.doc)!;
    expect(redone.doc).toEqual(step3);
  });
});

describe("InkHistory", () => {
  it("undoes and redoes a sequence", () => {
    const history = new InkHistory();
    let doc = docOf();
    for (const id of ["a", "b", "c"]) {
      const change = inkAddChange(doc, [item(id)]);
      doc = applyInkChange(doc, change);
      history.push(change);
    }
    expect(history.undoDepth).toBe(3);

    const first = history.undo(doc);
    expect(first && ids(first.doc)).toEqual(["a", "b"]);
    expect(first?.change.removed.map((r) => r.item.id)).toEqual(["c"]);
    doc = first!.doc;
    doc = history.undo(doc)!.doc;
    expect(ids(doc)).toEqual(["a"]);
    expect(history.redoDepth).toBe(2);

    const redone = history.redo(doc);
    expect(redone && ids(redone.doc)).toEqual(["a", "b"]);
    expect(redone?.change.added.map((a) => a.item.id)).toEqual(["b"]);
    doc = redone!.doc;
    expect(history.undoDepth).toBe(2);
    expect(history.redoDepth).toBe(1);
  });

  it("returns null when there is nothing to undo or redo", () => {
    const history = new InkHistory();
    expect(history.undo(docOf())).toBeNull();
    expect(history.redo(docOf())).toBeNull();
  });

  it("clears redo when a new change is pushed", () => {
    const history = new InkHistory();
    let doc = docOf();
    const add = inkAddChange(doc, [item("a")]);
    doc = applyInkChange(doc, add);
    history.push(add);
    doc = history.undo(doc)!.doc;
    expect(history.redoDepth).toBe(1);
    const next = inkAddChange(doc, [item("b")]);
    history.push(next);
    expect(history.redoDepth).toBe(0);
    expect(history.undoDepth).toBe(1);
  });

  it("restores erased ink to its old stacking position", () => {
    const history = new InkHistory();
    let doc = docOf(item("a"), item("b"), item("c"));
    const erase = inkReplaceChange(doc, new Map([["b", [item("b1")]]]));
    doc = applyInkChange(doc, erase);
    history.push(erase);
    expect(ids(doc)).toEqual(["a", "b1", "c"]);
    expect(ids(history.undo(doc)!.doc)).toEqual(["a", "b", "c"]);
  });

  it("drops the oldest change past the limit", () => {
    const history = new InkHistory(3);
    let doc = docOf();
    for (let i = 0; i < 5; i += 1) {
      const change = inkAddChange(doc, [item(`i${i}`)]);
      doc = applyInkChange(doc, change);
      history.push(change);
    }
    expect(history.undoDepth).toBe(3);
    for (let i = 0; i < 3; i += 1) doc = history.undo(doc)!.doc;
    expect(ids(doc)).toEqual(["i0", "i1"]);
    expect(history.undo(doc)).toBeNull();
  });

  it("defaults to the notebook history depth", () => {
    const history = new InkHistory();
    let doc = docOf();
    for (let i = 0; i < MAX_NOTEBOOK_HISTORY_ENTRIES + 10; i += 1) {
      const change = inkAddChange(doc, [item(`i${i}`)]);
      doc = applyInkChange(doc, change);
      history.push(change);
    }
    expect(history.undoDepth).toBe(MAX_NOTEBOOK_HISTORY_ENTRIES);
  });

  it("ignores changes that do nothing, and can be cleared", () => {
    const history = new InkHistory();
    history.push({ removed: [], added: [] });
    expect(history.undoDepth).toBe(0);
    const doc = docOf();
    history.push(inkAddChange(doc, [item("a")]));
    history.clear();
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(0);
  });

  it("leaves its stacks alone when an undo cannot be applied", () => {
    const history = new InkHistory();
    history.push(inkAddChange(docOf(), [item("a")]));
    expect(() => history.undo(docOf())).toThrow();
    expect(history.undoDepth).toBe(1);
    expect(history.redoDepth).toBe(0);
  });
});
