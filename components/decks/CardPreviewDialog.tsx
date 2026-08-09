"use client";

import { useRef } from "react";
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
      <DialogPanel className="relative w-full max-w-2xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-5 shadow-e3 sm:p-7">
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
                <StudyText
                  as="div"
                  text={card.front}
                  className="mt-3 whitespace-pre-wrap text-lg font-medium leading-8 text-text-primary"
                />
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.15em] text-text-muted">
                  Back
                </div>
                <StudyText
                  as="div"
                  text={card.back}
                  className="mt-3 whitespace-pre-wrap text-base leading-7 text-text-secondary"
                />
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
            <div className="mt-5 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onEdit(card)}
              >
                Edit card
              </Button>
            </div>
          </>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
