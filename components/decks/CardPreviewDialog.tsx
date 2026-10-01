"use client";

import { useRef } from "react";
import CardFaceImage from "@/components/cards/CardFaceImage";
import OcclusionFigure from "@/components/cards/OcclusionFigure";
import CardQualityWarnings from "@/components/decks/CardQualityWarnings";
import CardDifficultyBadge from "@/components/study/CardDifficultyBadge";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  StudyText,
} from "@/components/ui";
import { getCardQualityWarnings } from "@/lib/study/card-quality";
import type { Card } from "@/lib/study/cards";
import { getOcclusionPrompt, getOcclusionTargets } from "@/lib/study/image-occlusion";

type CardPreviewDialogProps = {
  card: Card | null;
  deckName: string;
  duplicateCount?: number;
  sourceNames?: string[];
  topicNames?: string[];
  onClose: () => void;
  onEdit: (card: Card) => void;
};

export default function CardPreviewDialog({
  card,
  deckName,
  duplicateCount,
  sourceNames = [],
  topicNames = [],
  onClose,
  onEdit,
}: CardPreviewDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={Boolean(card)}
      initialFocusRef={closeButtonRef}
      className="fixed inset-0 grid place-items-center overflow-y-auto p-4"
      onDismiss={() => onClose()}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <DialogPanel className={`relative w-full ${card?.occlusion ? "max-w-4xl" : "max-w-2xl"} rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-5 shadow-e3 sm:p-7`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Card preview
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm text-text-secondary">
              {deckName}
            </DialogDescription>
          </div>
          <Button
            ref={closeButtonRef}
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
        {card ? (
          <>
            <div className="mt-6 grid gap-4">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.15em] text-text-muted">
                  Front
                </div>
                {card.occlusion ? (
                  <div className="mt-3 space-y-2">
                    <OcclusionFigure occlusion={card.occlusion} phase="question" maxHeight="min(28rem, 45dvh)" />
                    <p className="text-center text-sm text-text-secondary">
                      {getOcclusionPrompt(card.occlusion, card.front)}
                    </p>
                  </div>
                ) : null}
                {card.frontImage ? (
                  <CardFaceImage
                    source={card.frontImage}
                    alt="Front image"
                    className="mt-3 max-h-72 w-full rounded-md object-contain"
                  />
                ) : null}
                {card.front.trim() && !card.occlusion ? (
                  <StudyText
                    as="div"
                    text={card.front}
                    className="mt-3 whitespace-pre-wrap text-lg font-medium leading-8 text-text-primary"
                  />
                ) : null}
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.15em] text-text-muted">
                  Back
                </div>
                {card.occlusion ? (
                  <div className="mt-3">
                    <OcclusionFigure occlusion={card.occlusion} phase="answer" maxHeight="min(28rem, 45dvh)" />
                  </div>
                ) : null}
                {card.backImage ? (
                  <CardFaceImage
                    source={card.backImage}
                    alt="Back image"
                    className="mt-3 max-h-72 w-full rounded-md object-contain"
                  />
                ) : null}
                {card.back.trim() ? (
                  <StudyText
                    as="div"
                    text={card.back}
                    className="mt-3 whitespace-pre-wrap text-base leading-7 text-text-secondary"
                  />
                ) : card.occlusion ? (
                  <p className="mt-3 text-sm text-text-muted">The answer is the label printed on the picture.</p>
                ) : null}
                {card.occlusion
                  ? getOcclusionTargets(card.occlusion).labels.flatMap((label) =>
                      label.note ? [
                        <StudyText key={label.id} as="p" text={label.note} className="mt-2 text-sm text-text-muted" />,
                      ] : []
                    )
                  : null}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <CardDifficultyBadge card={card} />
              <CardQualityWarnings
                warnings={getCardQualityWarnings(card, { duplicateCount })}
              />
              {sourceNames.map((sourceName) => (
                <span
                  key={`source-${sourceName}`}
                  className="max-w-full rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-medium text-warm-accent"
                >
                  <span className="block truncate">Based on: {sourceName}</span>
                </span>
              ))}
              {topicNames.map((topicName) => (
                <span
                  key={`topic-${topicName}`}
                  className="max-w-full rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent"
                >
                  <span className="block truncate">{topicName}</span>
                </span>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onEdit(card)}
              >
                {card.occlusion ? "Edit diagram" : "Edit card"}
              </Button>
            </div>
          </>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
