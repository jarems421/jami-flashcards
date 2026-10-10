/**
 * The browser side of the renderer harness, bundled by `../bundle.ts` into a
 * blank page. Everything the specs call is on `window.inkHarness`.
 */

import { legacyStrokes, liftCommit, liftRedraw, liftSetup, liftWrite, showEngine, showJsDraw } from "./fidelity";
import { measureChanges, measurePageOpen, measureWriting, measureZoomedPan, measureZoomSettle } from "./perf";

const inkHarness = {
  showJsDraw,
  showEngine,
  legacyStrokes,
  liftSetup,
  liftWrite,
  liftCommit,
  liftRedraw,
  measureWriting,
  measurePageOpen,
  measureZoomedPan,
  measureChanges,
  measureZoomSettle,
};

export type InkHarness = typeof inkHarness;

declare global {
  interface Window {
    inkHarness: InkHarness;
  }
}

window.inkHarness = inkHarness;
