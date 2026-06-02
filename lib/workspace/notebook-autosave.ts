export type NotebookSaveCompletionInput = {
  saveId: number;
  saveRevision: number;
  currentRevision: number;
  latestSaveId: number;
};

export function isNotebookSaveCompletionCurrent(input: NotebookSaveCompletionInput) {
  return input.saveId === input.latestSaveId && input.saveRevision === input.currentRevision;
}

export function shouldNotebookSaveUpdateLivePage(input: {
  pageId: string;
  selectedPageId: string | null;
  saveRevision: number;
  currentRevision: number;
}) {
  return (
    input.pageId === input.selectedPageId && input.saveRevision === input.currentRevision
  );
}

export function shouldNotebookSaveReplaceStoredPageContent(input: {
  pageId: string;
  selectedPageId: string | null;
  saveRevision: number;
  currentRevision: number;
}) {
  return input.pageId !== input.selectedPageId || input.saveRevision === input.currentRevision;
}
