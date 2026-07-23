import type { NotebookPage } from "@/lib/workspace/notebooks";

export type NotebookPageSwipeMotion = {
  phase: "settling" | "returning" | "handoff";
  kind: "page" | "create" | "cancel";
  direction: "next" | "previous" | null;
  targetPage: NotebookPage | null;
  targetOffset: number;
  durationMs: number;
};

export function resolveNotebookCarouselPages(input: {
  motion: NotebookPageSwipeMotion | null;
  previousPage: NotebookPage | null;
  nextPage: NotebookPage | null;
}) {
  const frozenHandoffPage =
    input.motion?.phase === "handoff" ? input.motion.targetPage : null;
  const settlingCreatePreview =
    input.motion?.kind === "create" && input.motion.phase !== "handoff";

  return {
    previousPage: frozenHandoffPage
      ? input.motion?.direction === "previous"
        ? frozenHandoffPage
        : null
      : input.previousPage,
    nextPage: frozenHandoffPage
      ? input.motion?.direction === "next"
        ? frozenHandoffPage
        : null
      : settlingCreatePreview
        ? null
        : input.nextPage,
  };
}

export function isNotebookPageSwipePreviewEnabled(zoom: number) {
  return zoom <= 1.0001;
}

export function getNotebookSwipePreviewDirection(offset: number) {
  if (offset < 0) return "next" as const;
  if (offset > 0) return "previous" as const;
  return null;
}

export function shouldShowNotebookNewPagePreview(input: {
  previewEnabled: boolean;
  hasNextPage: boolean;
  createPageActive: boolean;
  creatingPage: boolean;
  motionKind: NotebookPageSwipeMotion["kind"] | null;
  fullEditingEnabled: boolean;
  selectedPageIndex: number;
  pageCount: number;
}) {
  return (
    input.previewEnabled &&
    !input.hasNextPage &&
    (input.createPageActive ||
      input.creatingPage ||
      input.motionKind === "create" ||
      (input.fullEditingEnabled &&
        input.selectedPageIndex === input.pageCount - 1))
  );
}
