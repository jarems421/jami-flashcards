export function getNotebookPageIdFromSearch(search: string) {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(normalizedSearch).get("page");
}

export function buildNotebookPageSearch(search: string, pageId: string | null) {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  if (pageId) {
    params.set("page", pageId);
  } else {
    params.delete("page");
  }
  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}

export type NotebookExitSaveStatus =
  | "saved"
  | "unsaved"
  | "saving"
  | "failed";

export type NotebookExitDecision = {
  hasPendingChanges: boolean;
  saveQueued: boolean;
  shouldPreventNavigation: boolean;
};

/**
 * Performs the exit-critical draft and save handoff synchronously. Navigation
 * can continue immediately when there is nothing pending or when the current
 * page was successfully queued for persistence.
 */
export function prepareNotebookExit(input: {
  saveStatus: NotebookExitSaveStatus;
  persistDraftSync: () => void;
  queueSaveForExit: () => boolean;
}): NotebookExitDecision {
  const hasPendingChanges =
    input.saveStatus === "unsaved" || input.saveStatus === "failed";

  if (!hasPendingChanges) {
    return {
      hasPendingChanges: false,
      saveQueued: false,
      shouldPreventNavigation: false,
    };
  }

  input.persistDraftSync();
  const saveQueued = input.queueSaveForExit();

  return {
    hasPendingChanges: true,
    saveQueued,
    shouldPreventNavigation: !saveQueued,
  };
}
