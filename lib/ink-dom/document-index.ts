/**
 * The renderer's view of the document: items by id, their drawing order, and
 * a spatial index per layer, so a tile asks only for the items that meet it.
 * DOM-free.
 */

import type { InkChange } from "@/lib/ink/history";
import {
  emptyInkDocument,
  inkItemBounds,
  inkItemLayer,
  type InkBox,
  type InkDocument,
  type InkItem,
  type InkLayer,
} from "@/lib/ink/model";
import { InkSpatialIndex } from "@/lib/ink/spatial-index";

export class InkDocumentIndex {
  private doc: InkDocument = emptyInkDocument();
  private readonly byId = new Map<string, InkItem>();
  private readonly order = new Map<string, number>();
  private readonly layers: Record<InkLayer, InkSpatialIndex> = {
    highlighter: new InkSpatialIndex(),
    pen: new InkSpatialIndex(),
  };

  get document(): InkDocument {
    return this.doc;
  }

  reset(doc: InkDocument): void {
    this.doc = doc;
    this.byId.clear();
    this.order.clear();
    this.layers.highlighter.clear();
    this.layers.pen.clear();
    doc.items.forEach((item, index) => {
      this.insert(item);
      this.order.set(item.id, index);
    });
  }

  /**
   * Moves to `doc`, which is `change` applied to the current document.
   * Returns whether the change only put new items on top of the page, which
   * is what lets tiles be painted over rather than redrawn.
   */
  apply(doc: InkDocument, change: InkChange): { onTop: boolean } {
    const before = this.doc.items.length;
    for (const { item } of change.removed) this.remove(item);
    this.doc = doc;
    for (const { item } of change.added) this.insert(item);
    const added = change.added.slice().sort((a, b) => a.index - b.index);
    const onTop =
      change.removed.length === 0 && added.every(({ index }, offset) => index === before + offset);
    if (onTop) {
      for (const { index, item } of added) this.order.set(item.id, index);
    } else {
      this.order.clear();
      doc.items.forEach((item, index) => this.order.set(item.id, index));
    }
    return { onTop };
  }

  /** Items of `layer` whose boxes meet `box`, in drawing order. */
  query(layer: InkLayer, box: InkBox): InkItem[] {
    const ids = this.layers[layer].query(box);
    const items: InkItem[] = [];
    for (const id of ids) {
      const item = this.byId.get(id);
      if (item) items.push(item);
    }
    if (items.length > 1) {
      items.sort((a, b) => (this.order.get(a.id) ?? 0) - (this.order.get(b.id) ?? 0));
    }
    return items;
  }

  private insert(item: InkItem): void {
    // An item of a kind this build cannot draw has nothing to put in a tile.
    if (item.kind === "unknown") return;
    this.byId.set(item.id, item);
    this.layers[inkItemLayer(item)].set(item.id, inkItemBounds(item));
  }

  private remove(item: InkItem): void {
    if (this.byId.get(item.id) !== item) return;
    this.byId.delete(item.id);
    this.order.delete(item.id);
    this.layers[inkItemLayer(item)].delete(item.id);
  }
}
