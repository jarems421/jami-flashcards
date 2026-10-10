import type { Editor as JsDrawEditor } from "js-draw";
import type { NotebookInkStyle } from "@/lib/workspace/notebook-ink-types";
import {
  applyNotebookInkStyle,
  areNotebookInkStylesEqual,
  type JsDrawModule,
} from "@/lib/workspace/notebook-js-draw";

/**
 * Keeps js-draw's tools in step with the toolbar, without disturbing a stroke.
 *
 * Three things are tracked: what the toolbar asks for, what js-draw was last
 * given, and whether a change arrived while a pen was down. A change mid-stroke
 * waits for the pen to lift, because swapping the pen's style under a stroke in
 * progress would restyle ink already drawn. Applying is skipped when js-draw
 * already holds the style, since it rebuilds the pen's stroke factory.
 */
export class NotebookInkStyleSync {
  /** What the toolbar asks for. */
  desired: NotebookInkStyle;
  /** What js-draw was last given, or null before the first apply. */
  private applied: NotebookInkStyle | null = null;
  /** A change arrived while a pen was down, and waits for it to lift. */
  private deferred = false;

  constructor(initial: NotebookInkStyle) {
    this.desired = initial;
  }

  /** Gives js-draw what the toolbar asks for. */
  applyDesired(editor: JsDrawEditor, jsDraw: JsDrawModule) {
    this.deferred = false;
    applyNotebookInkStyle(editor, this.desired, jsDraw);
    this.applied = { ...this.desired };
  }

  /**
   * Gives js-draw the style for one contact -- the toolbar's, or the eraser
   * for a pen turned over -- unless it already holds it.
   */
  applyForContact(editor: JsDrawEditor, style: NotebookInkStyle, jsDraw: JsDrawModule) {
    this.deferred = false;
    if (areNotebookInkStylesEqual(this.applied, style)) return;
    applyNotebookInkStyle(editor, style, jsDraw);
    this.applied = { ...style };
  }

  /** Holds a change back until the pen lifts. */
  defer() {
    this.deferred = true;
  }

  /** Applies a change held back during a stroke, now that it has ended. */
  applyDeferred(editor: JsDrawEditor, jsDraw: JsDrawModule) {
    if (this.deferred) this.applyDesired(editor, jsDraw);
  }

  /** A new editor holds none of the styles given to the last one. */
  forgetApplied() {
    this.applied = null;
  }
}
