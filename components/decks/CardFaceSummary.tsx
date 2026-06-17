"use client";

import { StudyText } from "@/components/ui";

type CardFaceSummaryProps = {
  front: string;
  back: string;
  onPreview: () => void;
};

export default function CardFaceSummary({
  front,
  back,
  onPreview,
}: CardFaceSummaryProps) {
  return (
    <button
      type="button"
      onClick={onPreview}
      className="group w-full rounded-[1.1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 text-left transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)]"
      aria-label={`Preview card: ${front}`}
    >
      <StudyText
        as="div"
        text={front}
        className="line-clamp-4 whitespace-pre-wrap text-[0.95rem] font-semibold leading-6 text-text-primary sm:text-base sm:leading-7"
      />
      <div className="my-3 h-px bg-[var(--color-border)]" />
      <StudyText
        as="div"
        text={back}
        className="line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-text-secondary"
      />
      <div className="mt-3 text-xs font-medium text-text-muted transition group-hover:text-text-secondary">
        Preview full card
      </div>
    </button>
  );
}
