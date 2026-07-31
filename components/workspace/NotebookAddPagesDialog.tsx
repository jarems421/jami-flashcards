"use client";

import { Button, Card } from "@/components/ui";

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
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 backdrop-blur-sm sm:items-center sm:p-4">
      <Card
        padding="sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-notebook-pages-title"
        aria-describedby="add-notebook-pages-description"
        className="my-4 w-full max-w-lg"
      >
        <div>
          <div
            id="add-notebook-pages-title"
            className="text-sm font-semibold text-text-primary"
          >
            Add PDF or image pages
          </div>
          <p
            id="add-notebook-pages-description"
            className="mt-0.5 text-xs leading-5 text-text-muted"
          >
            The new pages will be added after the current last page.
          </p>
        </div>
        <label className="mt-4 block">
          <span className="sr-only">PDF or image</span>
          <input
            type="file"
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
      </Card>
    </div>
  );
}
