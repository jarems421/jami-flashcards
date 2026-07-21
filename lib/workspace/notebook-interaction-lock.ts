export const NOTEBOOK_EDITOR_LOCK_BODY_CLASS = "jami-notebook-editor-active";
export const NOTEBOOK_TEXT_EDITOR_SELECTOR =
  ".notebook-text-editor, [data-notebook-text-editor='true']";
export const NOTEBOOK_STYLUS_ACTION_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "label[for]",
  "summary",
  "[role='button']",
  "[role='menuitem']",
  "[role='slider']",
  "[data-notebook-stylus-action='true']",
].join(", ");
export const NOTEBOOK_STYLUS_GESTURE_CONTROL_SELECTOR =
  "[data-text-resize-handle='true']";

type ClosestTarget = {
  closest: (selector: string) => unknown;
};

function hasClosest(value: unknown): value is ClosestTarget {
  return (
    value !== null &&
    typeof value === "object" &&
    "closest" in value &&
    typeof (value as { closest?: unknown }).closest === "function"
  );
}

export function isNotebookTextEditingTarget(target: EventTarget | null) {
  if (!hasClosest(target)) return false;
  return Boolean(target.closest(NOTEBOOK_TEXT_EDITOR_SELECTOR));
}

/**
 * Controls inside the page should retain native tap/click behavior for Apple
 * Pencil. Resize handles are deliberately excluded: they are continuous page
 * gestures and still need the iPad navigation guard.
 */
export function isNotebookStylusActionTarget(target: EventTarget | null) {
  if (!hasClosest(target)) return false;
  if (target.closest(NOTEBOOK_STYLUS_GESTURE_CONTROL_SELECTOR)) return false;
  return Boolean(target.closest(NOTEBOOK_STYLUS_ACTION_SELECTOR));
}

export function shouldSuppressNotebookStylusTouch(input: {
  inkInteractionActive: boolean;
  stylusTouch: boolean;
  target: EventTarget | null;
}) {
  if (
    isNotebookTextEditingTarget(input.target) ||
    isNotebookStylusActionTarget(input.target)
  ) {
    return false;
  }
  return input.inkInteractionActive || input.stylusTouch;
}

export function shouldSuppressNotebookNativeEvent(target: EventTarget | null) {
  return !isNotebookTextEditingTarget(target);
}

export function shouldSuppressNotebookNativeInkPointer(input: {
  activeTool: string;
  pointerType: string;
  readOnly: boolean;
}) {
  return (
    !input.readOnly &&
    input.activeTool !== "text" &&
    input.pointerType === "pen"
  );
}

export function clearNotebookNativeSelection(documentRef: {
  getSelection: () => { rangeCount: number; removeAllRanges: () => void } | null;
}) {
  const selection = documentRef.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  selection.removeAllRanges();
  return true;
}
