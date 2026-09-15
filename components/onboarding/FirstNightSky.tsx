"use client";

import { NORTHERN_STAR_PATH } from "@/components/ui";
import { normalizeStar, type NormalizedStar } from "@/lib/constellation/stars";

export type SkyPoint = { x: number; y: number };

export function Sparkle({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 160 160" width={size} height={size} aria-hidden="true">
      <path d={NORTHERN_STAR_PATH} fill="currentColor" />
    </svg>
  );
}

/** The small star on a sidebar entry that still holds an unlit star. */
export function FirstNightNavStar() {
  return (
    <span className="fn-nav-star" aria-hidden="true">
      <Sparkle size={9} />
    </span>
  );
}

export function makeFirstNightStar(id: string, x: number, y: number, size = 3, glow = 0.9): NormalizedStar {
  return normalizeStar({ id, goalId: "", constellationId: "first-night", size, glow, createdAt: 1, position: { x, y } });
}

/**
 * Lines between stars that draw themselves in.
 *
 * Percentage coordinates rather than a stretched viewBox, so each line is drawn
 * at its real length and the dash that reveals it covers exactly that.
 */
export function DrawnLines({
  points,
  pairs,
  delay = 0,
  step = 0.2,
  ghost = false,
}: {
  points: SkyPoint[];
  pairs: [number, number][];
  delay?: number;
  step?: number;
  ghost?: boolean;
}) {
  return (
    <svg className={`fn-lines ${ghost ? "fn-lines-ghost" : ""}`} aria-hidden="true">
      {pairs.map(([a, b], index) => (
        <line
          key={`${a}-${b}`}
          x1={`${points[a].x}%`}
          y1={`${points[a].y}%`}
          x2={`${points[b].x}%`}
          y2={`${points[b].y}%`}
          pathLength={ghost ? undefined : 1}
          className={ghost ? undefined : "fn-draw"}
          style={ghost ? undefined : { animationDelay: `${delay + index * step}s` }}
        />
      ))}
    </svg>
  );
}
