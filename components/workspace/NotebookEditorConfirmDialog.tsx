"use client";

import { ConfirmDialog } from "@/components/ui";
import type { NotebookConfirmRequest } from "@/hooks/useNotebookPageManagement";

type NotebookEditorConfirmDialogProps = {
  request: NotebookConfirmRequest | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** The notebook editor's two destructive actions, each confirmed in its own words. */
export default function NotebookEditorConfirmDialog({
  request,
  busy,
  onConfirm,
  onClose,
}: NotebookEditorConfirmDialogProps) {
  const deleting = request?.kind === "delete-page";
  return (
    <ConfirmDialog
      open={request !== null}
      title={
        request?.kind === "delete-page"
          ? `Delete page ${request.page.pageNumber}?`
          : "Clear ink from this page?"
      }
      description={
        deleting
          ? "This removes the page's writing and text boxes. The other pages are renumbered."
          : "All handwriting and highlights on this page will be removed. Text boxes stay."
      }
      confirmLabel={deleting ? "Delete page" : "Clear ink"}
      busy={busy}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
