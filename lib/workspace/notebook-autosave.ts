export const NOTEBOOK_AUTOSAVE_IDLE_MS = 5_000;
export const NOTEBOOK_INK_UI_SYNC_IDLE_MS = 200;

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

export function shouldStartNotebookAutosave(input: {
  loading: boolean;
  saveStatus: "saved" | "unsaved" | "saving" | "failed";
  hasSelectedPage: boolean;
  inkInteractionActive: boolean;
}) {
  return (
    !input.loading &&
    input.saveStatus === "unsaved" &&
    input.hasSelectedPage &&
    !input.inkInteractionActive
  );
}

export function shouldDiscardNotebookInkExport(input: {
  svgAvailable: boolean;
  inkInteractionActive: boolean;
  saveRevision: number;
  currentRevision: number;
}) {
  return (
    !input.svgAvailable ||
    input.inkInteractionActive ||
    input.saveRevision !== input.currentRevision
  );
}
