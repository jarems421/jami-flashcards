"use client";

import CardFaceImage from "@/components/cards/CardFaceImage";
import { StudyText } from "@/components/ui";
import type { CardImage } from "@/lib/study/card-images";

type CardFaceSummaryProps = {
  front: string;
  back: string;
  frontImage?: CardImage;
  backImage?: CardImage;
  onPreview: () => void;
};

/** A side with no text is named by what it does have, not left blank. */
function sideText(text: string, image: CardImage | undefined, fallback: string) {
  return text.trim() || (image ? fallback : "");
}

export default function CardFaceSummary({
  front,
  back,
  frontImage,
  backImage,
  onPreview,
}: CardFaceSummaryProps) {
  const frontLabel = sideText(front, frontImage, "Image prompt");
  const backLabel = sideText(back, backImage, "Image answer");

  return (
    <button
      type="button"
      onClick={onPreview}
      className="group block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={`Preview card: ${frontLabel}`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {frontImage ? (
          <CardFaceImage
            source={frontImage}
            alt=""
            className="h-11 w-11 shrink-0 rounded-md object-cover"
          />
        ) : null}
        <StudyText
          as="div"
          text={frontLabel}
          className={`line-clamp-2 min-w-0 whitespace-pre-wrap text-base font-semibold leading-6 transition group-hover:text-accent ${
            front.trim() ? "text-text-primary" : "text-text-secondary"
          }`}
        />
      </div>
      <div className="mt-2 flex min-w-0 items-start gap-2 border-t border-[var(--color-border)] pt-2">
        {backImage ? (
          <CardFaceImage
            source={backImage}
            alt=""
            className="h-8 w-8 shrink-0 rounded object-cover"
          />
        ) : null}
        <StudyText
          as="div"
          text={backLabel}
          className="line-clamp-2 min-w-0 whitespace-pre-wrap text-xs leading-5 text-text-secondary"
        />
      </div>
    </button>
  );
}
