"use client";

import { useMemo, useRef, useState } from "react";
import { OcclusionPicture } from "@/components/cards/OcclusionFigure";
import ZoomableArea from "@/components/cards/ZoomableArea";
import DiagramStrengthLegend from "@/components/decks/diagram/DiagramStrengthLegend";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui";
import { useDiagramConfusions } from "@/hooks/useDiagramConfusions";
import type { Card } from "@/lib/study/cards";
import { getDiagramStrengths } from "@/lib/study/diagram-strength";
import {
  getLabelDisplayName,
  getWalkthroughMasks,
  type OcclusionDiagram,
} from "@/lib/study/image-occlusion";

type DiagramWalkthroughDialogProps = {
  /** The diagram to go over, or null for closed. */
  diagram: OcclusionDiagram | null;
  title: string;
  /** The diagram's cards, for how well each label is known and what gets mixed up. */
  cards?: readonly Card[];
  userId?: string;
  onClose: () => void;
};

/**
 * Going over a whole diagram by hand: every label covered, uncovered one at a
 * time by tapping it or stepping through in order, at any zoom.
 *
 * Practice, not review. It never touches a schedule, because a student
 * uncovering a label they have just looked at is not evidence they know it --
 * the label cards in Learn are where that is asked properly. It can also show
 * how well each label is known, and which pairs keep getting mixed up.
 */
export default function DiagramWalkthroughDialog({ diagram, title, cards = [], userId = "", onClose }: DiagramWalkthroughDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={Boolean(diagram)}
      initialFocusRef={closeRef}
      className="fixed inset-0 flex sm:p-4"
      onDismiss={onClose}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <DialogPanel className="relative m-auto flex h-full w-full flex-col overflow-hidden bg-[var(--color-surface-panel-strong)] shadow-e3 sm:h-[min(92dvh,56rem)] sm:max-w-5xl sm:rounded-2xl sm:border sm:border-[var(--color-border)]">
        {diagram ? (
          <Walkthrough
            key={diagram.id}
            diagram={diagram}
            title={title}
            cards={cards}
            userId={userId}
            closeRef={closeRef}
            onClose={onClose}
          />
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}

function Walkthrough({
  diagram,
  title,
  cards,
  userId,
  closeRef,
  onClose,
}: {
  diagram: OcclusionDiagram;
  title: string;
  cards: readonly Card[];
  userId: string;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  // The label just uncovered, whose words go in the footer.
  const [lastId, setLastId] = useState<string | null>(null);
  const [showStrength, setShowStrength] = useState(false);
  const strengths = useMemo(() => getDiagramStrengths(cards), [cards]);
  const confusions = useDiagramConfusions(userId, diagram, cards);
  const total = diagram.labels.length;
  const next = diagram.labels.find((label) => !revealed.has(label.id));
  const lastIndex = lastId && revealed.has(lastId) ? diagram.labels.findIndex((label) => label.id === lastId) : -1;
  const lastRevealed = lastIndex >= 0 ? diagram.labels[lastIndex] : undefined;

  const toggle = (labelId: string) => {
    const uncovering = !revealed.has(labelId);
    setRevealed((current) => {
      const updated = new Set(current);
      if (updated.has(labelId)) updated.delete(labelId);
      else updated.add(labelId);
      return updated;
    });
    if (uncovering) setLastId(labelId);
  };

  return (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <DialogTitle className="truncate text-base font-semibold text-text-primary">{title}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-text-muted">
            Tap a box to uncover it. Practice only: this does not change when cards are due.
          </DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {strengths.size > 0 ? (
            <Button
              type="button"
              size="sm"
              variant={showStrength ? "secondary" : "ghost"}
              aria-pressed={showStrength}
              onClick={() => setShowStrength((current) => !current)}
            >
              {showStrength ? "Hide strength" : "Show strength"}
            </Button>
          ) : null}
          <Button ref={closeRef} type="button" size="sm" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 bg-[var(--color-glass-subtle)] p-2 sm:p-4">
        <ZoomableArea label={`${title}, zoomable`}>
          <OcclusionPicture
            diagram={diagram}
            masks={getWalkthroughMasks(diagram, revealed)}
            label={`${title}: ${revealed.size} of ${total} labels uncovered`}
            fit="contain"
            onMaskActivate={toggle}
            tintByLabelId={showStrength ? strengths : undefined}
            className="shadow-card"
          />
        </ZoomableArea>
      </div>
      {showStrength || confusions.length > 0 ? (
        <div className="space-y-1.5 border-t border-[var(--color-border)] px-4 py-2.5 sm:px-6">
          {showStrength ? <DiagramStrengthLegend strengths={strengths} /> : null}
          {confusions.length > 0 ? (
            <p className="text-xs leading-5 text-text-secondary">
              <span className="font-semibold text-text-primary">Often mixed up: </span>
              {confusions
                .slice(0, 3)
                .map((pair) => `${pair.names[0]} and ${pair.names[1]} (${pair.count}×)`)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
      <footer className="flex flex-col gap-3 border-t border-[var(--color-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p role="status" className="min-h-[1.25rem] text-sm text-text-secondary">
          {lastRevealed
            ? `${lastIndex + 1}. ${getLabelDisplayName(lastRevealed, lastIndex)}${lastRevealed.note ? ` — ${lastRevealed.note}` : ""}`
            : `${total} label${total === 1 ? "" : "s"} covered.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={revealed.size === 0}
            onClick={() => setRevealed(new Set())}
          >
            Cover all
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={revealed.size === total}
            onClick={() => setRevealed(new Set(diagram.labels.map((label) => label.id)))}
          >
            Uncover all
          </Button>
          <Button type="button" size="sm" disabled={!next} onClick={() => next && toggle(next.id)}>
            {next ? `Uncover ${diagram.labels.indexOf(next) + 1}` : "All uncovered"}
          </Button>
        </div>
      </footer>
    </>
  );
}
