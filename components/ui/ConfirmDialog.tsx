"use client";

import { useRef } from "react";
import Button from "@/components/ui/Button";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/Dialog";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onClose: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  tone = "danger",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      dismissible={!busy}
      initialFocusRef={cancelButtonRef}
      className="fixed inset-0 flex items-end justify-center p-4 sm:items-center"
      onDismiss={() => onClose()}
    >
      <DialogBackdrop
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />
      <DialogPanel
        role="alertdialog"
        className="app-panel relative w-full max-w-md rounded-xl p-5 shadow-[0_28px_80px_rgba(0,0,0,0.5)] sm:p-6"
      >
        <DialogTitle className="text-xl font-semibold text-text-primary">
          {title}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-6 text-text-secondary">
          {description}
        </DialogDescription>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "danger" ? "danger" : "primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working..." : confirmLabel}
          </Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}
