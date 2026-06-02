import { describe, expect, it, vi } from "vitest";
import {
  clearNotebookNativeSelection,
  NOTEBOOK_TEXT_EDITOR_SELECTOR,
  isNotebookTextEditingTarget,
  shouldSuppressNotebookNativeEvent,
} from "@/lib/workspace/notebook-interaction-lock";

function makeTarget(match: boolean) {
  return {
    closest: vi.fn((selector: string) =>
      selector === NOTEBOOK_TEXT_EDITOR_SELECTOR && match ? {} : null
    ),
  } as unknown as EventTarget;
}

describe("notebook interaction lock", () => {
  it("allows native selection events inside the active text editor", () => {
    const target = makeTarget(true);

    expect(isNotebookTextEditingTarget(target)).toBe(true);
    expect(shouldSuppressNotebookNativeEvent(target)).toBe(false);
  });

  it("suppresses native selection events outside text editing", () => {
    const target = makeTarget(false);

    expect(isNotebookTextEditingTarget(target)).toBe(false);
    expect(shouldSuppressNotebookNativeEvent(target)).toBe(true);
    expect(shouldSuppressNotebookNativeEvent(null)).toBe(true);
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
