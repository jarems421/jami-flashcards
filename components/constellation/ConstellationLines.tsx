"use client";

import {
  getDrawableConstellationLines,
  type ConstellationLine,
} from "@/lib/constellation/constellations";
import type { NormalizedStar } from "@/lib/constellation/stars";

type ConstellationLinesProps = {
  lines: ConstellationLine[];
  stars: NormalizedStar[];
  /** Drawn faintly behind app content; brighter where the sky is the subject. */
  variant?: "default" | "background";
  /** A line being dragged out but not yet joined to anything. */
  pending?: { fromStarId: string; x: number; y: number } | null;
  onRemoveLine?: (line: ConstellationLine) => void;
};

/**
 * The lines a student has drawn between their stars.
 *
 * One SVG for the whole sky rather than an element per line. Positions are
 * percentages of the container, which is also how stars are placed, so the
 * viewBox is 0..100 in both axes with `preserveAspectRatio="none"` -- the
 * drawing stretches with the container exactly as the star positions do, and a
 * line stays attached to its stars at every window size without measuring
 * anything.
 *
 * That does mean a diagonal line is not at the angle its coordinates suggest,
 * since the axes scale differently. It is the same distortion the star
 * positions already carry, so the line still meets the stars it joins, which is
 * the only thing that has to stay true.
 */
export default function ConstellationLines({
  lines,
  stars,
  variant = "default",
  pending = null,
  onRemoveLine,
}: ConstellationLinesProps) {
  const positionsById = new Map(stars.map((star) => [star.id, star.position]));
  const drawable = getDrawableConstellationLines(lines, positionsById.keys());
  const pendingFrom = pending ? positionsById.get(pending.fromStarId) : undefined;

  if (drawable.length === 0 && !pendingFrom) {
    return null;
  }

  const isBackground = variant === "background";
  const stroke = isBackground
    ? "rgba(214, 200, 255, 0.28)"
    : "rgba(224, 214, 255, 0.5)";

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {drawable.map((line) => {
        const from = positionsById.get(line.a)!;
        const to = positionsById.get(line.b)!;
        const key = `${line.a}__${line.b}`;

        return (
          <g key={key}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={stroke}
              strokeWidth={0.28}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: isBackground ? 1 : 1.4 }}
            />
            {/*
              * A second, invisible line carrying the hit area.
              *
              * The drawn line is about a pixel wide, which is nothing to aim at
              * with a finger. This one is wide enough to hit and does not paint.
              */}
            {onRemoveLine ? (
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="transparent"
                vectorEffect="non-scaling-stroke"
                style={{ strokeWidth: 18, pointerEvents: "stroke", cursor: "pointer" }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onRemoveLine(line);
                }}
              />
            ) : null}
          </g>
        );
      })}
      {pendingFrom ? (
        <line
          x1={pendingFrom.x}
          y1={pendingFrom.y}
          x2={pending!.x}
          y2={pending!.y}
          stroke="rgba(224, 214, 255, 0.7)"
          strokeLinecap="round"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          style={{ strokeWidth: 1.4 }}
        />
      ) : null}
    </svg>
  );
}
