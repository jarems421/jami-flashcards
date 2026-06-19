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
      className="group block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={`Preview card: ${front}`}
    >
      <StudyText
        as="div"
        text={front}
        className="line-clamp-2 whitespace-pre-wrap text-[0.95rem] font-semibold leading-6 text-text-primary transition group-hover:text-accent"
      />
      <div className="mt-2 border-t border-[var(--color-border)] pt-2">
        <StudyText
          as="div"
          text={back}
          className="line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-text-secondary"
        />
      </div>
    </button>
  );
}
