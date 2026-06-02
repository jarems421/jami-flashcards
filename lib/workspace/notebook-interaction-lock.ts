export const NOTEBOOK_EDITOR_LOCK_BODY_CLASS = "jami-notebook-editor-active";
export const NOTEBOOK_TEXT_EDITOR_SELECTOR =
  ".notebook-text-editor, [data-notebook-text-editor='true']";

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

export function shouldSuppressNotebookNativeEvent(target: EventTarget | null) {
  return !isNotebookTextEditingTarget(target);
}

export function clearNotebookNativeSelection(documentRef: {
  getSelection: () => { rangeCount: number; removeAllRanges: () => void } | null;
}) {
  const selection = documentRef.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  selection.removeAllRanges();
  return true;
}
