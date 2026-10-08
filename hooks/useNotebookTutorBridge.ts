"use client";

import { useCallback, useMemo } from "react";
import type { NotebookPageStore } from "@/hooks/useNotebookPageState";
import type { PracticePaperStatus } from "@/lib/practice/practice-papers";
import { createNotebookAnswerBlock } from "@/lib/workspace/notebook-answer-block";
import { getNotebookAssistantQuickActions } from "@/lib/workspace/notebook-assistant";
import type { NotebookGraphBlock } from "@/lib/workspace/notebook-graphs";
import { makeNotebookTextBlockId } from "@/lib/workspace/notebook-page-content";
import type { Notebook, NotebookImageRef, NotebookTextBlock } from "@/lib/workspace/notebooks";
import { recordPracticePaperTutorUse } from "@/services/study/practice-papers";

/**
 * How the notebook and Tutor meet: opening and closing the floating Tutor,
 * the quick actions it offers for the page, and putting one of its answers on
 * the page exactly as it was shown.
 */
export function useNotebookTutorBridge(input: {
  userId: string;
  notebook: Notebook | null;
  pageState: NotebookPageStore;
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  setPagesDrawerOpen: (open: boolean) => void;
  closeDrawingToolMenus: () => void;
  practicePaperStatus: PracticePaperStatus | null;
  /** Whether the open page has anything on it, which changes what Tutor offers. */
  pageHasWork: boolean;
  pageEditingEnabled: boolean;
  currentImageRefsFor: (pageId: string) => NotebookImageRef[];
  currentGraphBlocksFor: (pageId: string) => NotebookGraphBlock[];
  insertTextBlock: (block: NotebookTextBlock) => boolean;
  showError: (message: string) => void;
  success: (message: string) => void;
}) {
  const {
    userId,
    notebook,
    pageState,
    assistantOpen,
    setAssistantOpen,
    setPagesDrawerOpen,
    closeDrawingToolMenus,
    practicePaperStatus,
    pageHasWork,
    pageEditingEnabled,
    currentImageRefsFor,
    currentGraphBlocksFor,
    insertTextBlock,
    showError,
    success,
  } = input;

  const quickActions = useMemo(
    () => getNotebookAssistantQuickActions({ hasWork: pageHasWork }),
    [pageHasWork]
  );

  const handleAssistantOpenChange = useCallback((open: boolean) => {
    if (open) {
      // Here rather than on the toolbar button: the floating Tutor reopens from its own pill too.
      if (!assistantOpen && practicePaperStatus === "in_progress" && userId && notebook) {
        void recordPracticePaperTutorUse(userId, notebook.id).catch(() => undefined);
      }
      setPagesDrawerOpen(false);
      closeDrawingToolMenus();
    }
    setAssistantOpen(open);
  }, [
    assistantOpen,
    closeDrawingToolMenus,
    notebook,
    practicePaperStatus,
    userId,
    setAssistantOpen,
    setPagesDrawerOpen,
  ]);

  /** A Tutor answer, added to this page exactly as the Tutor showed it. */
  const handleTutorAnswerInsert = useCallback(
    (text: string) => {
      const { selectedPage: page, textBlocks: currentTextBlocks } = pageState.read();
      if (!page) return false;
      if (!pageEditingEnabled) {
        showError("This page can't be edited here, so the answer can't be added to it.");
        return false;
      }
      const result = createNotebookAnswerBlock({
        id: makeNotebookTextBlockId(),
        text,
        page: {
          textBlocks: currentTextBlocks,
          imageRefs: currentImageRefsFor(page.id),
          graphBlocks: currentGraphBlocksFor(page.id),
        },
      });
      if (!result.ok) {
        showError(result.message);
        return false;
      }
      const added = insertTextBlock(result.block);
      if (added) success("Answer added to this page.");
      return added;
    },
    [
      currentGraphBlocksFor,
      currentImageRefsFor,
      insertTextBlock,
      pageEditingEnabled,
      pageState,
      showError,
      success,
    ]
  );

  return { quickActions, handleAssistantOpenChange, handleTutorAnswerInsert };
}
