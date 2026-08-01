"use client";

import { type ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui";

type WorkspaceActionDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  busy?: boolean;
  maxWidth?: "md" | "lg" | "xl";
  onClose: () => void;
};

const maxWidthClasses: Record<
  NonNullable<WorkspaceActionDialogProps["maxWidth"]>,
  string
> = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-5xl",
};

export default function WorkspaceActionDialog({
  open,
  title,
  description,
  children,
  busy = false,
  maxWidth = "md",
  onClose,
}: WorkspaceActionDialogProps) {
  return (
    <Dialog
      open={open}
      dismissible={!busy}
      className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-5"
      onDismiss={() => onClose()}
    >
      <DialogBackdrop
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <DialogPanel
        className={`app-panel relative flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-b-none rounded-t-[1.7rem] shadow-[0_28px_80px_rgba(0,0,0,0.5)] sm:max-h-[calc(100dvh-2.5rem)] sm:rounded-[1.9rem] ${maxWidthClasses[maxWidth]}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold tracking-tight text-text-primary sm:text-xl">
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription className="mt-1 max-w-2xl text-sm leading-6 text-text-muted">
                {description}
              </DialogDescription>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Close ${title}`}
            disabled={busy}
            onClick={onClose}
            className="shrink-0"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
              className="h-5 w-5"
            >
              <path d="m5 5 10 10M15 5 5 15" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">
          {children}
        </div>
      </DialogPanel>
    </Dialog>
  );
}
