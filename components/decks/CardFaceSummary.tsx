"use client";

import CardFaceImage from "@/components/cards/CardFaceImage";
import OcclusionFigure from "@/components/cards/OcclusionFigure";
import { StudyText } from "@/components/ui";
import type { CardImage } from "@/lib/study/card-images";
import {
  getGroupAnswerText,
  getGroupDisplayName,
  getLabelDisplayName,
  getOcclusionGroup,
  getOcclusionLabel,
  type CardOcclusion,
} from "@/lib/study/image-occlusion";

type CardFaceSummaryProps = {
  front: string;
  back: string;
  frontImage?: CardImage;
  backImage?: CardImage;
  occlusion?: CardOcclusion;
  onPreview: () => void;
};

/** A side with no text is named by what it does have, not left blank. */
function sideText(text: string, image: CardImage | undefined, fallback: string) {
  return text.trim() || (image ? fallback : "");
}

/**
 * What a diagram label card is called in a list.
 *
 * The header names the diagram and the label names the card. A label with no
 * words is printed on the picture, so it is named by its number and the
 * thumbnail shows which box that is.
 */
function diagramText(front: string, occlusion: CardOcclusion) {
  const group = getOcclusionGroup(occlusion);
  if (group) {
    const answers = getGroupAnswerText(occlusion.diagram, group);
    return {
      front: front.trim() || "Diagram",
      back: `${getGroupDisplayName(group)} · ${answers || `${group.labelIds.length} labels on the picture`}`,
    };
  }
  const { label, index } = getOcclusionLabel(occlusion);
  const total = occlusion.diagram.labels.length;
  return {
    front: front.trim() || "Diagram",
    back: label?.answer.trim()
      ? `${getLabelDisplayName(label, index)} · label ${index + 1} of ${total}`
      : `Label ${index + 1} of ${total}, on the picture`,
  };
}

export default function CardFaceSummary({
  front,
  back,
  frontImage,
  backImage,
  occlusion,
  onPreview,
}: CardFaceSummaryProps) {
  const diagram = occlusion ? diagramText(front, occlusion) : null;
  const frontLabel = diagram?.front ?? sideText(front, frontImage, "Image prompt");
  const backLabel = diagram?.back ?? sideText(back, backImage, "Image answer");

  return (
    <button
      type="button"
      onClick={onPreview}
      className="group block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={`Preview card: ${frontLabel}`}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {occlusion ? (
          <div className="h-11 w-14 shrink-0 overflow-hidden rounded-md bg-[var(--color-glass-subtle)]">
            <OcclusionFigure occlusion={occlusion} phase="question" fit="contain" compact />
          </div>
        ) : frontImage ? (
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
