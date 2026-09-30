"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCardImageUrl } from "@/hooks/useCardImageUrl";
import { CARD_STRENGTH_TINT_CLASSES, type CardStrength } from "@/lib/study/card-strength";
import {
  describeOcclusionMask,
  getOcclusionLabel,
  getOcclusionMasks,
  getOcclusionTargets,
  getPointerLine,
  type CardOcclusion,
  type OcclusionDiagram,
  type OcclusionMask,
  type OcclusionMaskDrawing,
  type OcclusionPhase,
  type OcclusionPointer,
  type OcclusionShape,
} from "@/lib/study/image-occlusion";

const percent = (value: number) => `${value * 100}%`;

export function occlusionShapeStyle(shape: OcclusionShape): CSSProperties {
  return {
    left: percent(shape.x),
    top: percent(shape.y),
    width: percent(shape.width),
    height: percent(shape.height),
    borderRadius: shape.kind === "ellipse" ? "50%" : shape.kind === "polygon" ? undefined : "0.3rem",
  };
}

/** A drawn outline, filling the box it is positioned by. Styled by the box's own class. */
export function OcclusionPolygon({ shape }: { shape: OcclusionShape }) {
  if (shape.kind !== "polygon" || !shape.points) return null;
  return (
    <svg aria-hidden="true" className="occlusion-shape-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
      <polygon
        points={shape.points.map((point) => `${point.x},${point.y}`).join(" ")}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Where a label's name goes: under its box, or over it near the bottom edge,
 * and pulled in at the sides so it never hangs off the picture.
 */
export function occlusionChipStyle(shape: OcclusionShape): CSSProperties {
  const centre = shape.x + shape.width / 2;
  const below = shape.y + shape.height <= 0.85;
  const horizontal =
    centre < 0.15
      ? { left: percent(shape.x), x: "0%" }
      : centre > 0.85
        ? { left: percent(shape.x + shape.width), x: "-100%" }
        : { left: percent(centre), x: "-50%" };
  return {
    left: horizontal.left,
    top: percent(below ? shape.y + shape.height : shape.y),
    transform: `translate(${horizontal.x}, ${below ? "4px" : "calc(-100% - 4px)"})`,
  };
}

export type OcclusionPointerTone = "asked" | "other" | "confused";
export type OcclusionPointerLine = {
  key: string;
  shape: OcclusionShape;
  pointer: OcclusionPointer;
  tone: OcclusionPointerTone;
};

const toneClass = (tone: OcclusionPointerTone) =>
  tone === "asked" ? "occlusion-pointer--asked" : tone === "confused" ? "occlusion-pointer--confused" : "";

/**
 * The lines from labels to what they point at.
 *
 * Drawn in the picture's own pixel space, so an oval's edge and the line meet
 * exactly, with a white halo under each line so it reads on a dark photo as
 * well as a white diagram. The line ends in a dot on the spot being named, or
 * an arrowhead when the diagram asks for one; a bent line bends once.
 */
export function OcclusionPointerLayer({
  lines,
  width,
  height,
  end = "dot",
  className = "",
}: {
  lines: readonly OcclusionPointerLine[];
  width: number;
  height: number;
  end?: "dot" | "arrow";
  className?: string;
}) {
  if (lines.length === 0) return null;
  const radius = Math.max(width, height) * 0.0065;
  return (
    <svg
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {lines.map(({ key, shape, pointer, tone }) => {
        const line = getPointerLine(shape, pointer, width, height);
        const tip = { x: pointer.x * width, y: pointer.y * height };
        const bend = pointer.bend ? { x: pointer.bend.x * width, y: pointer.bend.y * height } : null;
        const points = line
          ? [{ x: line.x1 * width, y: line.y1 * height }, ...(bend ? [bend] : []), tip]
          : [];
        const path = points.map((point) => `${point.x},${point.y}`).join(" ");
        // The arrowhead points along the last stretch of the line.
        const from = points.length >= 2 ? points[points.length - 2] : null;
        const angle = from ? Math.atan2(tip.y - from.y, tip.x - from.x) : 0;
        const size = radius * 3.2;
        const arrow = [
          tip,
          { x: tip.x - size * Math.cos(angle - 0.45), y: tip.y - size * Math.sin(angle - 0.45) },
          { x: tip.x - size * Math.cos(angle + 0.45), y: tip.y - size * Math.sin(angle + 0.45) },
        ]
          .map((point) => `${point.x},${point.y}`)
          .join(" ");
        return (
          <g key={key}>
            {path ? (
              <>
                <polyline points={path} className="occlusion-pointer-halo" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                <polyline points={path} className={`occlusion-pointer ${toneClass(tone)}`} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </>
            ) : null}
            {end === "arrow" && from ? (
              <polygon points={arrow} className={`occlusion-pointer-dot ${toneClass(tone)}`} stroke="rgba(255,255,255,0.85)" strokeWidth={radius * 0.5} />
            ) : (
              <>
                <circle cx={tip.x} cy={tip.y} r={radius * 1.7} className="occlusion-pointer-dot-halo" />
                <circle cx={tip.x} cy={tip.y} r={radius} className={`occlusion-pointer-dot ${toneClass(tone)}`} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const BOX_CLASSES: Record<NonNullable<OcclusionMaskDrawing["box"]>, string> = {
  cover: "occlusion-mask",
  "cover-asked": "occlusion-mask occlusion-mask--target",
  outline: "occlusion-outline",
  "outline-asked": "occlusion-outline occlusion-outline--target",
  "outline-confused": "occlusion-outline occlusion-outline--confused",
  slot: "occlusion-slot",
  "slot-asked": "occlusion-slot occlusion-slot--target",
  "slot-confused": "occlusion-slot occlusion-slot--confused",
};

/**
 * One label's boxes and words, as `describeOcclusionMask` says to draw them.
 *
 * With `onActivate` every drawn box is a button, for uncovering by hand. With
 * `tint` the boxes are coloured by how well the label is known.
 */
function MaskView({
  mask,
  drawing,
  compact,
  tint,
  onActivate,
}: {
  mask: OcclusionMask;
  drawing: OcclusionMaskDrawing;
  compact: boolean;
  tint?: CardStrength;
  onActivate?: (labelId: string) => void;
}) {
  const { label, look, index } = mask;
  if (!drawing.box) return null;
  const className = `${BOX_CLASSES[drawing.box]}${tint ? ` occlusion-tint ${CARD_STRENGTH_TINT_CLASSES[tint]}` : ""}`;
  const [first] = label.shapes;
  const name = label.answer.trim();
  const words = (kind: OcclusionMaskDrawing["inside"]) =>
    kind === "question" ? "?" : kind === "answer" ? name : "";
  const inside = compact ? "" : words(drawing.inside);
  const beside = compact ? "" : words(drawing.beside);
  const chipClass =
    look === "other-confused"
      ? "occlusion-chip occlusion-chip--confused"
      : look === "target-hidden" || look === "target-revealed"
        ? "occlusion-chip occlusion-chip--target"
        : "occlusion-chip";

  const content = (shape: OcclusionShape, shapeIndex: number): ReactNode => (
    <>
      <OcclusionPolygon shape={shape} />
      {shapeIndex === 0 && inside ? (
        <span className={`relative ${inside === "?" ? "occlusion-question-mark" : "occlusion-slot-text"}`}>{inside}</span>
      ) : null}
    </>
  );
  const shapeClass = (shape: OcclusionShape) =>
    `${className}${shape.kind === "polygon" ? " is-polygon" : " overflow-hidden"}`;

  return (
    <>
      {label.shapes.map((shape, shapeIndex) =>
        onActivate ? (
          <button
            key={shapeIndex}
            type="button"
            aria-label={
              look === "target-hidden"
                ? `Uncover label ${index + 1}`
                : `Cover label ${index + 1}${name ? `, ${name}` : ""}`
            }
            onClick={() => onActivate(label.id)}
            className={`absolute grid cursor-pointer place-items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-selected-border)] ${shapeClass(shape)}`}
            style={occlusionShapeStyle(shape)}
          >
            {content(shape, shapeIndex)}
          </button>
        ) : (
          <div
            key={shapeIndex}
            aria-hidden="true"
            className={`absolute grid place-items-center ${shapeClass(shape)}`}
            style={occlusionShapeStyle(shape)}
          >
            {content(shape, shapeIndex)}
          </div>
        )
      )}
      {beside && first ? (
        <span aria-hidden="true" className={`pointer-events-none absolute z-10 ${chipClass}`} style={occlusionChipStyle(first)}>
          {beside}
        </span>
      ) : null}
    </>
  );
}

function MagnifyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="h-4 w-4">
      <circle cx="10.6" cy="10.6" r="6" />
      <path d="m15 15 4.6 4.6M8 10.6h5.2M10.6 8v5.2" />
    </svg>
  );
}

type OcclusionPictureProps = {
  diagram: OcclusionDiagram;
  masks: OcclusionMask[];
  /** What a screen reader hears for the whole picture. */
  label: string;
  /**
   * `width`: as wide as its column, no taller than `maxHeight`.
   * `contain`: as large as fits the box it is in, like `object-contain`.
   */
  fit?: "width" | "contain";
  /** A CSS length, for `fit="width"`: a tall diagram shrinks rather than pushing the answer off screen. */
  maxHeight?: string;
  /** A thumbnail: boxes only, no words or question marks. */
  compact?: boolean;
  onMaskActivate?: (labelId: string) => void;
  /** Colour each label by how well it is known. */
  tintByLabelId?: ReadonlyMap<string, CardStrength>;
  /** Offers a magnifier in the corner, for a closer look. */
  onZoom?: () => void;
  /** A picture not uploaded yet: its local preview, drawn instead of the stored one. */
  imageUrl?: string | null;
  className?: string;
};

/**
 * A diagram's picture with its boxes drawn in a given state.
 *
 * Boxes are placed in percentages of the picture, so they stay on their labels
 * at any size -- a thumbnail, a phone, a projector. The picture's stored size
 * reserves its shape before it loads, so nothing jumps when it arrives.
 */
export function OcclusionPicture({
  diagram,
  masks,
  label,
  fit = "width",
  maxHeight,
  compact = false,
  onMaskActivate,
  tintByLabelId,
  onZoom,
  imageUrl,
  className = "",
}: OcclusionPictureProps) {
  const { image, labelMode } = diagram;
  const stored = useCardImageUrl(imageUrl === undefined ? image : undefined);
  const resolved = imageUrl === undefined ? stored : { url: imageUrl, failed: false };
  const aspect = image.width / image.height;
  const drawings = masks.map((mask) => describeOcclusionMask(labelMode, mask));
  const pointerLines = masks.flatMap((mask, position): OcclusionPointerLine[] => {
    const tone = drawings[position].pointer;
    const { pointer } = mask.label;
    const [shape] = mask.label.shapes;
    return tone && pointer && shape ? [{ key: mask.label.id, shape, pointer, tone }] : [];
  });
  const width =
    fit === "contain"
      ? `min(100cqw, calc(100cqh * ${aspect}))`
      : maxHeight
        ? `min(100%, calc(${maxHeight} * ${aspect}))`
        : "100%";

  const figure = (
    <div
      // An empty label means something around it already names the picture.
      {...(label ? { role: onMaskActivate ? "group" : "img", "aria-label": label } : { "aria-hidden": true })}
      className={`occlusion-figure relative mx-auto shrink-0 select-none overflow-hidden rounded-lg bg-white ${className}`}
      style={{ aspectRatio: `${image.width} / ${image.height}`, width }}
    >
      {resolved.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, per-user Storage URL that Next's image optimiser cannot fetch
        <img src={resolved.url} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
      ) : (
        <div
          className={`absolute inset-0 grid place-items-center bg-[var(--color-glass-subtle)] text-xs text-text-muted ${
            resolved.failed ? "" : "animate-pulse"
          }`}
        >
          {resolved.failed && !compact ? "Picture unavailable" : null}
        </div>
      )}
      <OcclusionPointerLayer
        lines={pointerLines.filter((line) => line.tone !== "asked")}
        width={image.width}
        height={image.height}
        end={diagram.pointerEnd}
      />
      {masks.map((mask, position) => (
        <MaskView
          key={mask.label.id}
          mask={mask}
          drawing={drawings[position]}
          compact={compact}
          tint={tintByLabelId?.get(mask.label.id)}
          onActivate={onMaskActivate}
        />
      ))}
      {/* The asked label's line goes over everything, so no neighbour's name can hide where it points. */}
      <OcclusionPointerLayer
        lines={pointerLines.filter((line) => line.tone === "asked")}
        width={image.width}
        height={image.height}
        end={diagram.pointerEnd}
        className="z-20"
      />
      {onZoom && !compact ? (
        <button
          type="button"
          aria-label="Look closer"
          title="Look closer"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            // The flashcard around this flips on a click; this one only zooms.
            event.stopPropagation();
            onZoom();
          }}
          className="occlusion-zoom-button absolute right-2 top-2 z-30 grid h-8 w-8 place-items-center rounded-full transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-selected-border)]"
        >
          <MagnifyIcon />
        </button>
      ) : null}
    </div>
  );

  if (fit !== "contain") return figure;
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center [container-type:size]">
      {figure}
    </div>
  );
}

function describe(occlusion: CardOcclusion, phase: OcclusionPhase) {
  const total = occlusion.diagram.labels.length;
  const { labels, indexes, group } = getOcclusionTargets(occlusion);
  if (group) {
    const which = indexes.map((index) => index + 1).join(", ");
    if (phase === "question") return `Diagram with labels ${which} of ${total} hidden`;
    const names = labels.map((label) => label.answer.trim()).filter(Boolean).join(", ");
    return names ? `Diagram with labels ${which} of ${total} shown: ${names}` : `Diagram with labels ${which} of ${total} shown`;
  }
  const { label, index } = getOcclusionLabel(occlusion);
  if (!label) return `Diagram with ${total} labels`;
  const position = `label ${index + 1} of ${total}`;
  if (phase === "question") return `Diagram with ${position} hidden`;
  const answer = label.answer.trim();
  return answer ? `Diagram with ${position} shown: ${answer}` : `Diagram with ${position} shown`;
}

type OcclusionFigureProps = Omit<OcclusionPictureProps, "diagram" | "masks" | "label" | "onMaskActivate"> & {
  occlusion: CardOcclusion;
  phase: OcclusionPhase;
  /** Overrides the diagram's own setting; multiple choice hides every label. */
  hideOthers?: boolean;
  /** On the answer side: the label the student gave instead of the right one. */
  confusedLabelId?: string | null;
};

/** One diagram card's picture: what it asks, asked or answered, the rest as the diagram says. */
export default function OcclusionFigure({
  occlusion,
  phase,
  hideOthers,
  confusedLabelId,
  ...props
}: OcclusionFigureProps) {
  return (
    <OcclusionPicture
      {...props}
      diagram={occlusion.diagram}
      masks={getOcclusionMasks(occlusion, phase, { hideOthers, confusedLabelId })}
      label={describe(occlusion, phase)}
    />
  );
}
