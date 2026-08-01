"use client";

import { useRef } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui";

export type ObjectActionsSheetAction = {
  id: string;
  label: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect: () => void;
};

type ObjectActionsSheetProps = {
  open: boolean;
  objectKind: "deck" | "notebook";
  title: string;
  actions: ObjectActionsSheetAction[];
  onClose: () => void;
};

export default function ObjectActionsSheet({
  open,
  objectKind,
  title,
  actions,
  onClose,
}: ObjectActionsSheetProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      initialFocusRef={cancelButtonRef}
      className="fixed inset-0 flex items-end p-3 md:hidden"
      onDismiss={() => onClose()}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <DialogPanel
        data-mobile-object-actions={objectKind}
        className="app-panel relative w-full rounded-[1.5rem] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.38)]"
      >
        <div className="px-2 pb-3 pt-1">
          <DialogTitle className="truncate text-sm font-semibold text-text-primary">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs text-text-muted">
            {objectKind === "deck" ? "Deck actions" : "Notebook actions"}
          </DialogDescription>
        </div>
        <div className="grid gap-2">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              disabled={action.disabled}
              className={`min-h-12 rounded-[1rem] px-4 text-left text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                action.tone === "danger"
                  ? "bg-[var(--color-error-muted)] text-danger-text"
                  : "bg-[var(--color-glass-subtle)] text-text-primary"
              }`}
              onClick={() => {
                onClose();
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
          <button
            ref={cancelButtonRef}
            type="button"
            className="min-h-12 rounded-[1rem] px-4 text-left text-sm font-semibold text-text-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}
