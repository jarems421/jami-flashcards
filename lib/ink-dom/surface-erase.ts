import { inkRemoveChange, inkReplaceChange, type InkChange } from "@/lib/ink/history";
import type { InkDocument, InkPoint } from "@/lib/ink/model";
import type { InkSpatialIndex } from "@/lib/ink/spatial-index";
import { inkEraserSweepBox, inkItemsTouchedBySweep, inkPrecisionErase } from "@/lib/ink/tools/erase";

/**
 * One eraser gesture, from the eraser landing to it lifting.
 *
 * Every packet's sweep is tested and applied at once, so the student sees ink
 * go as the eraser passes. Nothing is recorded for undo here: the surface
 * pushes the whole gesture as one step when it ends, from the document it
 * started with. Per packet, the work is proportional to the items the sweep's
 * box meets (the spatial index finds them), not to the page.
 */

/** What the gesture needs of the surface that owns the page. */
export type InkEraseHost = {
  index: InkSpatialIndex;
  doc(): InkDocument;
  /** Applies `change` to the page: document, index and renderer. No history, no callbacks. */
  apply(change: InkChange): void;
};

export type InkEraseInput = {
  mode: "stroke" | "precision";
  /** The eraser's radius in page units. */
  radius: number;
  at: InkPoint;
};

export class InkEraseGesture {
  /** The page as it was when the eraser landed. */
  readonly startDoc: InkDocument;
  private last: InkPoint;

  constructor(
    private readonly host: InkEraseHost,
    private readonly input: InkEraseInput
  ) {
    this.startDoc = host.doc();
    this.last = input.at;
    // Landing on ink erases it, as a tap should.
    this.sweep([input.at]);
  }

  move(points: readonly InkPoint[]): void {
    if (points.length === 0) return;
    this.sweep([this.last, ...points]);
    this.last = points[points.length - 1];
  }

  private sweep(points: readonly InkPoint[]): void {
    const doc = this.host.doc();
    const sweep = { points, radius: this.input.radius };
    const candidates = this.host.index.query(inkEraserSweepBox(sweep));
    if (candidates.length === 0) return;
    if (this.input.mode === "stroke") {
      const touched = inkItemsTouchedBySweep(doc, candidates, sweep);
      if (touched.length > 0) this.host.apply(inkRemoveChange(doc, touched));
      return;
    }
    const replacements = inkPrecisionErase(doc, candidates, sweep);
    if (replacements.size > 0) this.host.apply(inkReplaceChange(doc, replacements));
  }
}
