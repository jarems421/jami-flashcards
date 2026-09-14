"use client";

import { useRef } from "react";
import DeckCoverIcon from "@/components/decks/DeckCoverIcon";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  Input,
} from "@/components/ui";
import type { Deck } from "@/lib/study/decks";
import type {
  DeckColorPresetId,
  DeckIconPresetId,
} from "@/lib/study/deck-style";
import type { StudyFolder } from "@/lib/workspace/study-folders";

export type DeckDraft = {
  name: string;
  colorPreset: DeckColorPresetId;
  iconPreset: DeckIconPresetId;
  folderId: string;
};

type DeckEditorDialogProps = {
  /** The deck being edited. Null closes the dialog. */
  deck: Deck | null;
  draft: DeckDraft;
  folders: StudyFolder[];
  saving: boolean;
  deleting: boolean;
  onDraftChange: (patch: Partial<DeckDraft>) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
};

/**
 * Editing one deck, lifted above the grid it came from.
 *
 * It used to open inside the deck's own tile. The decks sit in a two-column
 * grid, so the tile grew a full form and the deck beside it stretched to the
 * same height -- the card editor had exactly this problem and moved into a
 * dialog for the same reason. The rest of the page now stays where it was.
 */
export default function DeckEditorDialog({
  deck,
  draft,
  folders,
  saving,
  deleting,
  onDraftChange,
  onCancel,
  onSave,
  onDelete,
}: DeckEditorDialogProps) {
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const busy = saving || deleting;
  const dirty = deck
    ? draft.name !== deck.name ||
      draft.colorPreset !== deck.colorPreset ||
      draft.iconPreset !== deck.iconPreset ||
      draft.folderId !== (deck.folderIds[0] ?? "")
    : false;

  return (
    <Dialog
      open={Boolean(deck)}
      initialFocusRef={nameFieldRef}
      // Once something has changed, a stray click behind the dialog should not
      // throw it away; Cancel and Escape still close it.
      closeOnBackdrop={!dirty && !busy}
      closeOnEscape={!busy}
      className="fixed inset-0 grid place-items-center overflow-y-auto p-4"
      onDismiss={() => onCancel()}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <DialogPanel className="relative my-auto w-full max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] shadow-e3">
        {deck ? (
          <>
            <div className="flex items-center gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
              <DeckCoverIcon
                colorPreset={draft.colorPreset}
                iconPreset={draft.iconPreset}
                className="h-12 w-12"
              />
              <div className="min-w-0">
                <DialogTitle className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  Edit deck
                </DialogTitle>
                <DialogDescription className="mt-1 truncate text-base font-medium text-text-primary">
                  {draft.name.trim() || "Untitled deck"}
                </DialogDescription>
              </div>
            </div>

            <div className="space-y-4 px-5 py-5 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  ref={nameFieldRef}
                  label="Deck name"
                  value={draft.name}
                  placeholder="Deck name"
                  disabled={busy}
                  onChange={(event) => onDraftChange({ name: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || busy || !draft.name.trim()) return;
                    event.preventDefault();
                    onSave();
                  }}
                />
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-text-secondary">
                    Folder
                  </span>
                  <select
                    value={draft.folderId}
                    disabled={busy}
                    onChange={(event) => onDraftChange({ folderId: event.target.value })}
                    className="app-field min-h-[2.75rem] w-full rounded-2xl px-3 text-sm outline-none"
                  >
                    <option value="">No folder</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <ObjectStylePicker
                color={draft.colorPreset}
                icon={draft.iconPreset}
                onColorChange={(colorPreset) => onDraftChange({ colorPreset })}
                onIconChange={(iconPreset) => onDraftChange({ iconPreset })}
                colorLabel="Deck colour"
                iconLabel="Deck icon"
                compact
              />
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={onDelete}
                className="w-full text-error sm:w-auto"
              >
                {deleting ? "Deleting..." : "Delete deck"}
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={onCancel}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={busy || !draft.name.trim()}
                  onClick={onSave}
                  className="w-full sm:w-auto"
                >
                  {saving ? "Saving..." : "Save deck"}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
