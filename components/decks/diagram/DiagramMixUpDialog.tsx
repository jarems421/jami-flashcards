"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import { OcclusionPicture } from "@/components/cards/OcclusionFigure";
import ZoomableArea from "@/components/cards/ZoomableArea";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui";
import {
  describeLastMixUp,
  getMixUpLabels,
  getMixUpMasks,
  type DiagramMixUp,
} from "@/lib/study/diagram-confusion";
import { getLabelDisplayName } from "@/lib/study/image-occlusion";

type DiagramMixUpDialogProps = {
  /** The pair to compare, or null for closed. */
  mixUp: DiagramMixUp | null;
  now: number;
  onClose: () => void;
};

/**
 * Two labels a student keeps giving for each other, side by side on their
 * diagram: the first outlined in purple, the other in amber, as a study card
 * outlines a mix-up. Covering both and tapping each turns the comparison into
 * a check of which is which.
 *
 * Practice, not review: nothing here reaches a schedule or the Learning
 * Engine. Learn is where the cards are asked properly.
 */
export default function DiagramMixUpDialog({ mixUp, now, onClose }: DiagramMixUpDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={Boolean(mixUp)} initialFocusRef={closeRef} className="fixed inset-0 flex sm:p-4" onDismiss={onClose}>
      <DialogBackdrop className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <DialogPanel className="relative m-auto flex h-full w-full flex-col overflow-hidden bg-[var(--color-surface-panel-strong)] shadow-e3 sm:h-[min(92dvh,56rem)] sm:max-w-5xl sm:rounded-2xl sm:border sm:border-[var(--color-border)]">
        {mixUp ? (
          <MixUpCompare
            key={`${mixUp.diagram.id}:${mixUp.labelIds.join(":")}`}
            mixUp={mixUp}
            now={now}
            closeRef={closeRef}
            onClose={onClose}
          />
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}

function MixUpCompare({
  mixUp,
  now,
  closeRef,
  onClose,
}: {
  mixUp: DiagramMixUp;
  now: number;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { diagram, labelIds, count, lastAt, title } = mixUp;
  const [covered, setCovered] = useState<ReadonlySet<string>>(() => new Set());
  const tappable = useMemo(() => new Set(labelIds), [labelIds]);
  const pair = getMixUpLabels(diagram, labelIds);
  const names = pair?.map(({ label, index }) => getLabelDisplayName(label, index)) ?? [];
  const when = [
    `Mixed up ${count === 1 ? "once" : `${count} times`}`,
    lastAt !== undefined ? `last ${describeLastMixUp(lastAt, now)}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const toggle = (labelId: string) => {
    if (!tappable.has(labelId)) return;
    setCovered((current) => {
      const next = new Set(current);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  };

  return (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <DialogTitle className="text-base font-semibold text-text-primary">
            {names.length === 2 ? `${names[0]} and ${names[1]}` : "Mixed-up labels"}
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-text-muted">
            {title} · {when}. Practice only: this does not change when cards are due.
          </DialogDescription>
        </div>
        <Button ref={closeRef} type="button" size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </header>

      <div className="min-h-0 flex-1 bg-[var(--color-glass-subtle)] p-2 sm:p-4">
        <ZoomableArea label={`${title}, zoomable`}>
          <OcclusionPicture
            diagram={diagram}
            masks={getMixUpMasks(diagram, labelIds, covered)}
            label={`${title}: ${names.join(" and ")}, ${covered.size === 0 ? "both showing" : `${covered.size} of 2 covered`}`}
            fit="contain"
            onMaskActivate={toggle}
            activatableLabelIds={tappable}
            className="shadow-card"
          />
        </ZoomableArea>
      </div>

      {pair ? (
        <ul className="grid gap-2 border-t border-[var(--color-border)] px-4 py-3 sm:grid-cols-2 sm:px-6">
          {pair.map(({ label, index }, position) => (
            <li
              key={label.id}
              className="flex min-w-0 items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2.5"
            >
              <span
                aria-hidden="true"
                className={`occlusion-key mt-1 ${position === 0 ? "occlusion-key--target" : "occlusion-key--confused"}`}
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">
                  {getLabelDisplayName(label, index)}
                  <span className="sr-only">{position === 0 ? ", outlined in purple" : ", outlined in amber"}</span>
                </p>
                <p className="text-xs text-text-muted">
                  Label {index + 1}
                  {covered.has(label.id) ? " · covered" : ""}
                </p>
                {label.note ? <p className="mt-1 text-xs leading-5 text-text-secondary">{label.note}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="flex flex-col gap-3 border-t border-[var(--color-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p role="status" className="min-h-[1.25rem] text-sm text-text-secondary">
          {covered.size === 0
            ? "Look at where each one is, then cover them to check you can tell them apart."
            : covered.size === 2
              ? "Say which is which, then tap a box to check."
              : "Tap the covered box to check it."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={covered.size === 0}
            onClick={() => setCovered(new Set())}
          >
            Show both
          </Button>
          <Button type="button" size="sm" disabled={covered.size === 2} onClick={() => setCovered(new Set(labelIds))}>
            Cover both
          </Button>
        </div>
      </footer>
    </>
  );
}
