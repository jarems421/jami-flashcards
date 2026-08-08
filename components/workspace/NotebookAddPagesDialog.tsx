"use client";

import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui";

type NotebookAddPagesDialogProps = {
  open: boolean;
  /** The chosen file, or null before one is picked. */
  file: File | null;
  adding: boolean;
  /** Upload percentage, or null when no upload is running. */
  progress: number | null;
  onFileChange: (file: File | null) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function NotebookAddPagesDialog({
  open,
  file,
  adding,
  progress,
  onFileChange,
  onCancel,
  onConfirm,
}: NotebookAddPagesDialogProps) {
  return (
    <Dialog
      open={open}
      dismissible={!adding}
      closeOnBackdrop={false}
      className="fixed inset-0 flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-4"
      onDismiss={() => onCancel()}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/45 backdrop-blur-sm" />
      <DialogPanel
        className="app-panel relative my-4 w-full max-w-lg overflow-hidden rounded-xl p-3 backdrop-blur-md transition duration-fast sm:rounded-2xl sm:p-4"
      >
        <div>
          <DialogTitle className="text-sm font-semibold text-text-primary">
            Add PDF or image pages
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-xs leading-5 text-text-muted">
            The new pages will be added after the current last page.
          </DialogDescription>
        </div>
        <label className="mt-4 block">
          <span className="sr-only">PDF or image</span>
          <input
            type="file"
            data-dialog-autofocus="true"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={adding}
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
            className="block min-h-[2.75rem] w-full rounded-xl border border-border bg-surface-panel-strong px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-full file:border-0 file:bg-warm-glow file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-warm-accent disabled:cursor-not-allowed"
          />
        </label>
        {adding && progress !== null ? (
          <div
            role="progressbar"
            aria-label="Notebook file upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-glass-subtle)]"
          >
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-success))] transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={adding}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!file || adding}
            onClick={onConfirm}
          >
            {adding
              ? progress !== null
                ? `Adding ${progress}%`
                : "Adding pages..."
              : "Add pages"}
          </Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}
