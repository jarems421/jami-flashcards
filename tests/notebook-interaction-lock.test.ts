import { describe, expect, it, vi } from "vitest";
import {
  clearNotebookNativeSelection,
  isNotebookStylusActionTarget,
  NOTEBOOK_TEXT_EDITOR_SELECTOR,
  NOTEBOOK_STYLUS_ACTION_SELECTOR,
  NOTEBOOK_STYLUS_GESTURE_CONTROL_SELECTOR,
  isNotebookTextEditingTarget,
  shouldSuppressNotebookNativeEvent,
  shouldSuppressNotebookNativeInkPointer,
  shouldSuppressNotebookStylusTouch,
} from "@/lib/workspace/notebook-interaction-lock";

function makeTarget(...matchingSelectors: string[]) {
  const matches = new Set(matchingSelectors);
  return {
    closest: vi.fn((selector: string) => (matches.has(selector) ? {} : null)),
  } as unknown as EventTarget;
}

describe("notebook interaction lock", () => {
  it("allows native selection events inside the active text editor", () => {
    const target = makeTarget(NOTEBOOK_TEXT_EDITOR_SELECTOR);

    expect(isNotebookTextEditingTarget(target)).toBe(true);
    expect(shouldSuppressNotebookNativeEvent(target)).toBe(false);
  });

  it("suppresses native selection events outside text editing", () => {
    const target = makeTarget();

    expect(isNotebookTextEditingTarget(target)).toBe(false);
    expect(shouldSuppressNotebookNativeEvent(target)).toBe(true);
    expect(shouldSuppressNotebookNativeEvent(null)).toBe(true);
  });

  it("allows Pencil taps on notebook actions but keeps resize handles guarded", () => {
    const action = makeTarget(NOTEBOOK_STYLUS_ACTION_SELECTOR);
    const resizeHandle = makeTarget(
      NOTEBOOK_STYLUS_ACTION_SELECTOR,
      NOTEBOOK_STYLUS_GESTURE_CONTROL_SELECTOR
    );

    expect(isNotebookStylusActionTarget(action)).toBe(true);
    expect(isNotebookStylusActionTarget(resizeHandle)).toBe(false);
  });

  it("suppresses stylus touch gestures only on non-action page targets", () => {
    expect(
      shouldSuppressNotebookStylusTouch({
        inkInteractionActive: false,
        stylusTouch: true,
        target: makeTarget(NOTEBOOK_STYLUS_ACTION_SELECTOR),
      })
    ).toBe(false);
    expect(
      shouldSuppressNotebookStylusTouch({
        inkInteractionActive: true,
        stylusTouch: true,
        target: makeTarget(NOTEBOOK_TEXT_EDITOR_SELECTOR),
      })
    ).toBe(false);
    expect(
      shouldSuppressNotebookStylusTouch({
        inkInteractionActive: false,
        stylusTouch: true,
        target: makeTarget(),
      })
    ).toBe(true);
    expect(
      shouldSuppressNotebookStylusTouch({
        inkInteractionActive: true,
        stylusTouch: false,
        target: makeTarget(),
      })
    ).toBe(true);
    expect(
      shouldSuppressNotebookStylusTouch({
        inkInteractionActive: false,
        stylusTouch: false,
        target: makeTarget(),
      })
    ).toBe(false);
  });

  it("suppresses native browser gestures for editable Pencil ink", () => {
    expect(
      shouldSuppressNotebookNativeInkPointer({
        activeTool: "pen",
        pointerType: "pen",
        readOnly: false,
      })
    ).toBe(true);
    expect(
      shouldSuppressNotebookNativeInkPointer({
        activeTool: "eraser",
        pointerType: "pen",
        readOnly: false,
      })
    ).toBe(true);
  });

  it("leaves finger navigation, text editing, and read-only pages alone", () => {
    expect(
      shouldSuppressNotebookNativeInkPointer({
        activeTool: "pen",
        pointerType: "touch",
        readOnly: false,
      })
    ).toBe(false);
    expect(
      shouldSuppressNotebookNativeInkPointer({
        activeTool: "text",
        pointerType: "pen",
        readOnly: false,
      })
    ).toBe(false);
    expect(
      shouldSuppressNotebookNativeInkPointer({
        activeTool: "pen",
        pointerType: "pen",
        readOnly: true,
      })
    ).toBe(false);
  });

  it("clears accidental notebook selections", () => {
    const removeAllRanges = vi.fn();
    const documentRef = {
      getSelection: () => ({ rangeCount: 1, removeAllRanges }),
    };

    expect(clearNotebookNativeSelection(documentRef)).toBe(true);
    expect(removeAllRanges).toHaveBeenCalledTimes(1);
  });

  it("does not report a clear when no selection exists", () => {
    const removeAllRanges = vi.fn();
    const documentRef = {
      getSelection: () => ({ rangeCount: 0, removeAllRanges }),
    };

    expect(clearNotebookNativeSelection(documentRef)).toBe(false);
    expect(removeAllRanges).not.toHaveBeenCalled();
  });
});
