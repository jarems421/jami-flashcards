"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { planShootingStarPath, planShootingStarTimings } from "@/lib/constellation/shooting-stars";

/**
 * Streaks falling across whatever sky this sits inside. Purely decorative.
 *
 * A streak moves to a new place each time its cycle comes round, while it is
 * invisible, so the sky does not show the same streak in the same spot forever.
 *
 * The head and tail are real elements rather than pseudo-elements so the
 * notebook's pause rule, which matches descendants with `*`, reaches them too.
 */
export default function ShootingStars({ count, seed }: { count: number; seed: string }) {
  const timings = useMemo(() => planShootingStarTimings(count, seed), [count, seed]);
  const [passes, setPasses] = useState<Record<number, number>>({});
  if (timings.length === 0) return null;

  return (
    <div aria-hidden="true" className="shooting-stars">
      {timings.map((timing, index) => {
        const path = planShootingStarPath(seed, index, passes[index] ?? 0);
        const timingStyle = {
          animationDuration: `${timing.duration}s`,
          animationDelay: `${timing.delay}s`,
        };
        return (
          <span
            key={index}
            className={`shooting-star shooting-star--${path.tint}${path.fireball ? " shooting-star--fireball" : ""}`}
            onAnimationIteration={(event) => {
              // Head and tail iterate too, and their events bubble here.
              if (event.target !== event.currentTarget) return;
              setPasses((current) => ({ ...current, [index]: (current[index] ?? 0) + 1 }));
            }}
            style={
              {
                top: `${path.top}%`,
                left: `${path.left}%`,
                width: path.length,
                ...timingStyle,
                "--shooting-angle": `${path.angle}deg`,
                "--shooting-travel": `${-path.travel}px`,
              } as CSSProperties
            }
          >
            <span className="shooting-star-tail" style={timingStyle} />
            <span className="shooting-star-head" style={timingStyle} />
          </span>
        );
      })}
    </div>
  );
}
