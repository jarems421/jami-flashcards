import {
  NORTHERN_STAR_PATH,
  northernStarTransform,
} from "@/components/ui/NorthernStar";

/*
 * Deliberately flat. A taller zig-zag reads as a chart; kept shallow and wide
 * it reads as a constellation, and it fits the strip of space the quest card
 * and the sign-in panel each have for it.
 */
const POINTS: readonly (readonly [number, number])[] = [
  [10, 33],
  [24, 16],
  [39, 27],
  [53, 9],
  [67, 23],
  [81, 7],
  [94, 25],
] as const;

const VIEW_BOX = "0 0 104 42";

export const CONSTELLATION_TRAIL_LENGTH = POINTS.length;

type ConstellationTrailProps = {
  /** How many of the seven are finished. */
  completed: number;
  size?: "sm" | "md" | "lg";
  /**
   * Draw it as a picture rather than a readout: no marker on the mission in
   * hand, and out of the accessibility tree. For places that already say where
   * the student is in words, and for the signed-out page, which is showing the
   * shape of the thing rather than anyone's progress through it.
   */
  decorative?: boolean;
  className?: string;
};

/*
 * Sized by width, with the height following the viewBox. Fixing both would
 * letterbox the drawing inside its own box at some sizes and shrink the stars
 * for no reason.
 */
const sizeClasses: Record<NonNullable<ConstellationTrailProps["size"]>, string> = {
  sm: "h-auto w-24",
  md: "h-auto w-44",
  lg: "h-auto w-full max-w-[17rem]",
};

function line(from: number, to: number) {
  return POINTS.slice(from, to)
    .map((point) => point.join(","))
    .join(" ");
}

/**
 * Seven stars on a rising line: the walkthrough's progress, and the signed-out
 * page's picture of what finishing it looks like.
 *
 * Progress reads as the stars filling in rather than a bar filling up. A point
 * not yet reached is a faint mark, the mission in hand is an outline, and a
 * finished one is a solid white star, with the connecting line brightening
 * behind them -- so the shape says how far along the student is without any
 * numbers.
 */
export default function ConstellationTrail({
  completed,
  size = "md",
  decorative = false,
  className = "",
}: ConstellationTrailProps) {
  const lit = Math.max(0, Math.min(completed, POINTS.length));
  const accessibility = decorative
    ? ({ "aria-hidden": true } as const)
    : ({
        role: "img",
        "aria-label": `${lit} of ${POINTS.length} walkthrough missions complete`,
      } as const);

  return (
    <svg
      viewBox={VIEW_BOX}
      className={`${sizeClasses[size]} ${className}`}
      {...accessibility}
    >
      <polyline
        points={line(0, POINTS.length)}
        fill="none"
        stroke="var(--color-border-strong)"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      {lit > 1 ? (
        <polyline
          points={line(0, lit)}
          fill="none"
          stroke="var(--color-text-primary)"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.55"
        />
      ) : null}
      {POINTS.map(([x, y], index) => {
        if (index < lit) {
          return (
            <path
              key={`${x}-${y}`}
              d={NORTHERN_STAR_PATH}
              transform={northernStarTransform(x, y, 13)}
              fill="var(--color-text-primary)"
            />
          );
        }

        if (index === lit && !decorative) {
          return (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="6" fill="var(--color-accent)" opacity="0.24" />
              <path
                d={NORTHERN_STAR_PATH}
                transform={northernStarTransform(x, y, 13)}
                fill="none"
                stroke="var(--color-text-primary)"
                strokeWidth="10"
                strokeLinejoin="round"
                opacity="0.9"
              />
            </g>
          );
        }

        return (
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r="1.6"
            fill="var(--color-text-muted)"
            opacity="0.45"
          />
        );
      })}
    </svg>
  );
}
