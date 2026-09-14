"use client";

import { useRef } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Input,
} from "@/components/ui";
import type { Topic } from "@/lib/material/topics";

type TopicRenameDialogProps = {
  /** The Topic being renamed. Null closes the dialog. */
  topic: Topic | null;
  name: string;
  saving: boolean;
  onNameChange: (name: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

/**
 * Renaming a Topic, above the grid rather than inside it.
 *
 * The rename field used to replace the Topic's tile and widen it to two
 * columns. The grid gives every row the same height, so one rename reshuffled
 * and stretched every Topic on the page. Decks and cards had the same problem
 * and edit in a dialog for the same reason.
 */
export default function TopicRenameDialog({
  topic,
  name,
  saving,
  onNameChange,
  onCancel,
  onSave,
}: TopicRenameDialogProps) {
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const dirty = topic ? name !== topic.name : false;
  const canSave = !saving && Boolean(name.trim());

  return (
    <Dialog
      open={Boolean(topic)}
      initialFocusRef={nameFieldRef}
      closeOnBackdrop={!dirty && !saving}
      closeOnEscape={!saving}
      className="fixed inset-0 grid place-items-center overflow-y-auto p-4"
      onDismiss={() => onCancel()}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <DialogPanel className="relative my-auto w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] shadow-e3">
        {topic ? (
          <>
            <div className="px-5 pt-5 sm:px-6 sm:pt-6">
              <DialogTitle className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                Rename Topic
              </DialogTitle>
            </div>
            <div className="px-5 py-5 sm:px-6">
              <Input
                ref={nameFieldRef}
                label="Topic name"
                value={name}
                disabled={saving}
                onChange={(event) => onNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || !canSave) return;
                  event.preventDefault();
                  onSave();
                }}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={onCancel}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!canSave}
                onClick={onSave}
                className="w-full sm:w-auto"
              >
                {saving ? "Saving..." : "Save Topic"}
              </Button>
            </div>
          </>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
