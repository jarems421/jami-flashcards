import { describe, expect, it, vi } from "vitest";
import {
  clearNotebookNativeSelection,
  isNotebookStylusActionTarget,
  NOTEBOOK_TEXT_EDITOR_SELECTOR,
  NOTEBOOK_STYLUS_ACTION_SELECTOR,
  NOTEBOOK_STYLUS_GESTURE_CONTROL_SELECTOR,
  isNotebookSelectableTextTarget,
  isNotebookTextEditingTarget,
  NOTEBOOK_SELECTABLE_TEXT_SELECTOR,
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

  it("treats a form field over the page, like the graph editor's, as text editing", () => {
    const dialogField = makeTarget("input, textarea, select, [contenteditable='true']");
    const fieldOnPage = makeTarget("input, textarea, select, [contenteditable='true']", ".notebook-page-surface");

    expect(isNotebookTextEditingTarget(dialogField)).toBe(true);
    expect(shouldSuppressNotebookNativeEvent(dialogField)).toBe(false);
    // A control inside the page itself is still the page.
    expect(isNotebookTextEditingTarget(fieldOnPage)).toBe(false);
  });

  it("suppresses native selection events outside text editing", () => {
    const target = makeTarget();

    expect(isNotebookTextEditingTarget(target)).toBe(false);
    expect(shouldSuppressNotebookNativeEvent(target)).toBe(true);
    expect(shouldSuppressNotebookNativeEvent(null)).toBe(true);
  });

  it("lets the Tutor's answers be selected and copied without counting as editing", () => {
    const answer = makeTarget(NOTEBOOK_SELECTABLE_TEXT_SELECTOR);
    // Selection starts on a text node, which has no closest of its own.
    const textInAnswer = { nodeType: 3, parentElement: answer } as unknown as EventTarget;
    const markedOnPage = makeTarget(NOTEBOOK_SELECTABLE_TEXT_SELECTOR, ".notebook-page-surface");

    expect(shouldSuppressNotebookNativeEvent(answer)).toBe(false);
    expect(shouldSuppressNotebookNativeEvent(textInAnswer)).toBe(false);
    expect(isNotebookSelectableTextTarget(textInAnswer)).toBe(true);
    expect(isNotebookTextEditingTarget(answer)).toBe(false);
    // The page itself stays locked, whatever is marked on it.
    expect(shouldSuppressNotebookNativeEvent(markedOnPage)).toBe(true);
    expect(isNotebookSelectableTextTarget({ nodeType: 3, parentElement: null })).toBe(false);
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
