"use client";

import TutorSettingsPanel from "@/components/ai/TutorSettingsPanel";
import { Dialog, DialogBackdrop, DialogPanel } from "@/components/ui/Dialog";

type TutorSettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  activeFolderIds?: readonly string[];
};

/**
 * The settings panel as a right-side drawer, for surfaces that are a page
 * rather than a conversation.
 *
 * Full height and edge-to-edge below the small breakpoint, because a settings
 * form with a text area in it is not something to do through a letterbox on a
 * phone. Above it, the same 32rem column the Jami drawer uses, so the two read
 * as the same object arriving from the same side.
 */
export default function TutorSettingsDrawer({
  open,
  onClose,
  activeFolderIds,
}: TutorSettingsDrawerProps) {
  return (
    <Dialog
      open={open}
      className="fixed inset-0 z-50 flex justify-end"
      onDismiss={onClose}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" />
      <DialogPanel
        aria-label="Tutor settings"
        className="pointer-events-auto relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[32rem] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] shadow-shell"
      >
        <TutorSettingsPanel
          activeFolderIds={activeFolderIds}
          onBack={onClose}
          backLabel="Done"
        />
      </DialogPanel>
    </Dialog>
  );
}
