"use client";

import { Fragment, useMemo } from "react";
import {
  getDrawableConstellationLines,
  type ConstellationLine,
} from "@/lib/constellation/constellations";
import type { NormalizedStar } from "@/lib/constellation/stars";

type Point = { x: number; y: number };

type PendingLine = {
  fromStarId: string;
  x: number;
  y: number;
  /** The star the line is currently over, if the drag would land on one. */
  toStarId?: string | null;
};

type ConstellationLinesProps = {
  lines: ConstellationLine[];
  stars: NormalizedStar[];
  /** Drawn faintly behind app content; brighter where the sky is the subject. */
  variant?: "default" | "background";
  /** A line being dragged out but not yet joined to anything. */
  pending?: PendingLine | null;
  /**
   * Must be stable across renders.
   *
   * The drawn figure is memoised on it, and a fresh arrow function every render
   * rebuilds every line on every pointer move -- which is exactly the moment
   * the drag needs the frames.
   */
  onRemoveLine?: (line: ConstellationLine) => void;
};

/** The one colour a drawn line is allowed to be: starlight, slightly cool. */
const LINE_TONE = "214, 221, 255";

const rgba = (alpha: number) => `rgba(${LINE_TONE}, ${alpha})`;

/**
 * A gradient id built from two star ids.
 *
 * Anything outside a word character is stripped, because the id ends up inside
 * `url(#...)` where a stray character silently paints nothing -- a line that is
 * simply invisible, with no error anywhere to say why.
 */
const gradientId = (variant: string, line: ConstellationLine) =>
  `${variant}-${line.a}-${line.b}`.replace(/[^\w-]/g, "");

/**
 * How a line is painted, per variant.
 *
 * Two strokes, always: a wide, very faint haze under a thin bright core. One
 * stroke at one alpha is a pencil line on black, and no amount of choosing the
 * alpha fixes that -- what makes a line look like light rather than ink is
 * having light around it. Both are in screen pixels, so a line is the same
 * weight on a phone and a desktop.
 */
const LINE_PAINT = {
  default: { core: 1.25, haze: 5.5, coreAlpha: 0.9, hazeAlpha: 0.15 },
  background: { core: 1, haze: 4, coreAlpha: 0.5, hazeAlpha: 0.08 },
} as const;

/**
 * A stroke that fades to nothing at both ends.
 *
 * This is what makes the figure read as a constellation rather than a diagram.
 * A line that runs hard into a star crosses its glow and covers the thing it is
 * pointing at; one that dissolves a little short of it reads as the eye joining
 * them up. It is also what stops several lines meeting at one star and turning
 * it into a hub.
 */
function fadedGradient(id: string, from: Point, to: Point, alpha: number) {
  return (
    <linearGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
    >
      <stop offset="0%" stopColor={rgba(0)} />
      <stop offset="14%" stopColor={rgba(alpha * 0.45)} />
      <stop offset="50%" stopColor={rgba(alpha)} />
      <stop offset="86%" stopColor={rgba(alpha * 0.45)} />
      <stop offset="100%" stopColor={rgba(0)} />
    </linearGradient>
  );
}

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
  const positionsById = useMemo(
    () => new Map(stars.map((star) => [star.id, star.position])),
    [stars]
  );
  const drawable = useMemo(
    () => getDrawableConstellationLines(lines, positionsById.keys()),
    [lines, positionsById]
  );
  const paint =
    variant === "background" ? LINE_PAINT.background : LINE_PAINT.default;

  /*
   * The finished figure, built once and reused while a line is being dragged.
   *
   * Dragging one line re-renders this component on every pointer move, and
   * without this it rebuilt every gradient and every stroke each time -- up to
   * 120 edges of work per move, for a figure that has not changed. Holding the
   * elements by reference lets React skip the subtree outright.
   */
  const figure = useMemo(
    () => (
      <>
        <defs>
          {drawable.map((line) => {
            const from = positionsById.get(line.a)!;
            const to = positionsById.get(line.b)!;
            const id = gradientId(variant, line);

            return (
              <Fragment key={id}>
                {fadedGradient(`${id}-core`, from, to, paint.coreAlpha)}
                {fadedGradient(`${id}-haze`, from, to, paint.hazeAlpha)}
              </Fragment>
            );
          })}
        </defs>

        {/*
          * The whole figure breathes as one, on a single animation.
          *
          * Per-line would be one animation per edge and up to 120 of them; the
          * sky already has a frame budget and lines are not where it should go.
          * It is opacity only, so the compositor carries it.
          */}
        <g className="constellation-line-layer">
          {drawable.map((line) => {
            const from = positionsById.get(line.a)!;
            const to = positionsById.get(line.b)!;
            const id = gradientId(variant, line);

            return (
              <g key={id} className="constellation-line-enter">
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={`url(#${id}-haze)`}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ strokeWidth: paint.haze }}
                />
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={`url(#${id}-core)`}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ strokeWidth: paint.core }}
                />
                {/*
                  * A third, invisible line carrying the hit area.
                  *
                  * The drawn line is about a pixel wide, which is nothing to
                  * aim at with a finger. This one is wide enough to hit and
                  * does not paint.
                  */}
                {onRemoveLine ? (
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="transparent"
                    vectorEffect="non-scaling-stroke"
                    style={{
                      strokeWidth: 18,
                      pointerEvents: "stroke",
                      cursor: "pointer",
                      // Or swiping a line scrolls the page instead of taking it
                      // back, which on a tablet is the whole screen moving.
                      touchAction: "none",
                    }}
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
        </g>
      </>
    ),
    [drawable, onRemoveLine, paint, positionsById, variant]
  );

  const pendingFrom = pending ? positionsById.get(pending.fromStarId) : undefined;

  if (drawable.length === 0 && !pendingFrom) {
    return null;
  }

  /*
   * A line that would land on a star ends on that star rather than under the
   * finger. The snap is the whole feedback: the moment the line jumps to a star
   * and holds there, letting go stops being a guess.
   */
  const pendingTo: Point | undefined =
    (pending?.toStarId ? positionsById.get(pending.toStarId) : undefined) ??
    (pending ? { x: pending.x, y: pending.y } : undefined);
  const pendingIsArmed = Boolean(
    pending?.toStarId &&
      pending.toStarId !== pending.fromStarId &&
      positionsById.has(pending.toStarId)
  );

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {figure}

      {pendingFrom && pendingTo ? (
        <>
          <defs>
            {fadedGradient(
              `${variant}-pending-core`,
              pendingFrom,
              pendingTo,
              pendingIsArmed ? 0.95 : 0.6
            )}
            {fadedGradient(
              `${variant}-pending-haze`,
              pendingFrom,
              pendingTo,
              pendingIsArmed ? 0.22 : 0.12
            )}
          </defs>
          <line
            x1={pendingFrom.x}
            y1={pendingFrom.y}
            x2={pendingTo.x}
            y2={pendingTo.y}
            stroke={`url(#${variant}-pending-haze)`}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: pendingIsArmed ? 7 : 5.5 }}
          />
          {/*
            * Unjoined, it is a dashed thread drifting toward whatever it might
            * reach; over a star, it closes into a solid line and holds still.
            * The difference has to read from the corner of the eye, because the
            * finger is on the other end of it.
            */}
          <line
            x1={pendingFrom.x}
            y1={pendingFrom.y}
            x2={pendingTo.x}
            y2={pendingTo.y}
            stroke={`url(#${variant}-pending-core)`}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={pendingIsArmed ? undefined : "constellation-line-drift"}
            style={{
              strokeWidth: pendingIsArmed ? 1.6 : 1.3,
              strokeDasharray: pendingIsArmed ? undefined : "2.5 3",
            }}
          />
        </>
      ) : null}
    </svg>
  );
}
