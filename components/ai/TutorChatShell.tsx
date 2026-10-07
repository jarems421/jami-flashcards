"use client";

import type { ComponentProps, ReactNode } from "react";
import { Dialog, DialogBackdrop, DialogPanel } from "@/components/ui";

/**
 * The frame the chat sits in: a dialog over the work, or -- inline -- a card
 * in the page. Everything inside is the same either way.
 */
export default function TutorChatShell({
  inline,
  open,
  dialogProps,
  backdropClassName,
  panelProps,
  afterPanel,
  children,
}: {
  inline: boolean;
  open: boolean;
  dialogProps: Omit<ComponentProps<typeof Dialog>, "children" | "open">;
  backdropClassName: string;
  panelProps: ComponentProps<typeof DialogPanel>;
  afterPanel?: ReactNode;
  children: ReactNode;
}) {
  if (inline) {
    return open ? (
      <section
        aria-label="Jami chat"
        data-notebook-text-editor="true"
        className="app-panel relative flex h-[min(82dvh,58rem)] min-h-[30rem] w-full flex-col overflow-hidden rounded-3xl"
      >
        {children}
      </section>
    ) : null;
  }
  return (
    <Dialog {...dialogProps} open={open}>
      <DialogBackdrop className={backdropClassName} />
      <DialogPanel {...panelProps}>{children}</DialogPanel>
      {afterPanel}
    </Dialog>
  );
}
