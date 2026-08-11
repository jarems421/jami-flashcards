"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { NotebookPageStore } from "@/hooks/useNotebookPageState";
import type { NotebookPage } from "@/lib/workspace/notebooks";

export function usePracticePaperRetake(
  pageState: NotebookPageStore,
  setPages: Dispatch<SetStateAction<NotebookPage[]>>,
  remountInkEditor: Dispatch<SetStateAction<number>>
) {
  return useCallback(() => {
    pageState.resetHydration();
    const now = Date.now();
    setPages((current) => current.map((page) => ({
      ...page,
      typedContent: undefined,
      textBlocks: [],
      inkData: undefined,
      strokeData: undefined,
      thumbnail: undefined,
      status: "blank" as const,
      contentRevision: page.contentRevision + 1,
      updatedAt: now,
    })));
    remountInkEditor((current) => current + 1);
  }, [pageState, remountInkEditor, setPages]);
}
