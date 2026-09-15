"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { planShootingStarPath, planShootingStarTimings } from "@/lib/constellation/shooting-stars";

/**
 * Streaks falling across whatever sky this sits inside. Purely decorative.
 *
 * A streak moves to a new place each time its cycle comes round, while it is
 * invisible, so the sky does not show the same streak in the same spot forever.
 */
export default function ShootingStars({ count, seed }: { count: number; seed: string }) {
  const timings = useMemo(() => planShootingStarTimings(count, seed), [count, seed]);
  const [passes, setPasses] = useState<Record<number, number>>({});
  if (timings.length === 0) return null;

  return (
    <div aria-hidden="true" className="shooting-stars">
      {timings.map((timing, index) => {
        const path = planShootingStarPath(seed, index, passes[index] ?? 0);
        return (
          <span
            key={index}
            className="shooting-star"
            onAnimationIteration={() => setPasses((current) => ({ ...current, [index]: (current[index] ?? 0) + 1 }))}
            style={
              {
                top: `${path.top}%`,
                left: `${path.left}%`,
                width: path.length,
                animationDuration: `${timing.duration}s`,
                animationDelay: `${timing.delay}s`,
                "--shooting-angle": `${path.angle}deg`,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
