/**
 * Invertible ink changes and the undo stack that holds them.
 *
 * A change is the whole edit written as data: the items taken out and the
 * items put in, each with its position. Applying it, and applying its inverse,
 * therefore restore the exact document, and the renderer can read the same
 * change to learn which tiles to redraw. Add, erase, move, restyle and clear
 * are all built from the same shape.
 */

import type { InkDocument, InkItem } from "@/lib/ink/model";
import { MAX_NOTEBOOK_HISTORY_ENTRIES } from "@/lib/workspace/notebook-history";

type IndexedItem = { index: number; item: InkItem };

/**
 * `removed` indices are positions in the document before the change; `added`
 * indices are positions in the document after it.
 */
export type InkChange = {
  removed: IndexedItem[];
  added: IndexedItem[];
};

function isEmptyChange(change: InkChange): boolean {
  return change.removed.length === 0 && change.added.length === 0;
}

/**
 * Removes the `removed` items (highest index first, so earlier indices stay
 * valid), then inserts the `added` ones (lowest index first, so each lands at
 * its final position). Throws if the document is not the one the change was
 * made for, rather than corrupting it quietly.
 */
export function applyInkChange(doc: InkDocument, change: InkChange): InkDocument {
  const items = doc.items.slice();
  const removed = change.removed.slice().sort((a, b) => b.index - a.index);
  for (let i = 0; i < removed.length; i += 1) {
    const { index, item } = removed[i];
    if (i > 0 && removed[i - 1].index === index) {
      throw new Error(`Ink change removes position ${index} twice.`);
    }
    if (items[index]?.id !== item.id) {
      throw new Error(`Ink change expected item "${item.id}" at position ${index}.`);
    }
    items.splice(index, 1);
  }
  const added = change.added.slice().sort((a, b) => a.index - b.index);
  for (const { index, item } of added) {
    if (!Number.isInteger(index) || index < 0 || index > items.length) {
      throw new Error(`Ink change cannot insert at position ${index}.`);
    }
    items.splice(index, 0, item);
  }
  return { version: doc.version, items };
}

export function invertInkChange(change: InkChange): InkChange {
  return { removed: change.added, added: change.removed };
}

/** Appends `items` on top of the page. */
export function inkAddChange(doc: InkDocument, items: InkItem[]): InkChange {
  const start = doc.items.length;
  return { removed: [], added: items.map((item, offset) => ({ index: start + offset, item })) };
}

/** Removes the items with these ids; ids not in the document are ignored. */
export function inkRemoveChange(doc: InkDocument, ids: Iterable<string>): InkChange {
  return inkReplaceChange(doc, new Map(Array.from(ids, (id) => [id, []] as [string, InkItem[]])));
}

/**
 * Swaps items for their replacements, in place in the stacking order: each
 * item's replacements take its position, in order. This is how an eraser
 * splits a stroke and how a lasso transform rewrites a selection. An empty
 * array removes the item.
 */
export function inkReplaceChange(
  doc: InkDocument,
  replacements: Map<string, InkItem[]>
): InkChange {
  const removed: IndexedItem[] = [];
  const added: IndexedItem[] = [];
  let position = 0;
  doc.items.forEach((item, index) => {
    const replacement = replacements.get(item.id);
    if (!replacement) {
      position += 1;
      return;
    }
    removed.push({ index, item });
    for (const next of replacement) {
      added.push({ index: position, item: next });
      position += 1;
    }
  });
  return { removed, added };
}

/** Takes everything off the page. */
export function inkClearChange(doc: InkDocument): InkChange {
  return { removed: doc.items.map((item, index) => ({ index, item })), added: [] };
}

export type InkHistoryStep = { doc: InkDocument; change: InkChange };

/**
 * Undo and redo stacks of {@link InkChange}s, capped like the rest of the
 * notebook's history. A new change clears redo; the oldest falls off the cap.
 */
export class InkHistory {
  private undoStack: InkChange[] = [];
  private redoStack: InkChange[] = [];

  constructor(private readonly limit = MAX_NOTEBOOK_HISTORY_ENTRIES) {}

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /** Records a change that was just applied. Changes that do nothing are not worth an undo. */
  push(change: InkChange): void {
    if (isEmptyChange(change)) return;
    this.undoStack.push(change);
    if (this.undoStack.length > this.limit) {
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
    this.redoStack = [];
  }

  /**
   * Reverses the latest change. Returns the new document and the change that
   * was applied to get it (for dirty regions), or null with nothing to undo.
   * The stacks only move once the change applied cleanly.
   */
  undo(doc: InkDocument): InkHistoryStep | null {
    const change = this.undoStack[this.undoStack.length - 1];
    if (!change) return null;
    const applied = invertInkChange(change);
    const next = applyInkChange(doc, applied);
    this.undoStack.pop();
    this.redoStack.push(change);
    return { doc: next, change: applied };
  }

  redo(doc: InkDocument): InkHistoryStep | null {
    const change = this.redoStack[this.redoStack.length - 1];
    if (!change) return null;
    const next = applyInkChange(doc, change);
    this.redoStack.pop();
    this.undoStack.push(change);
    return { doc: next, change };
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
