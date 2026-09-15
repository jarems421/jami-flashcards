"use client";

import { useMemo, type CSSProperties } from "react";
import { planShootingStars } from "@/lib/constellation/shooting-stars";

/** Streaks falling across whatever sky this sits inside. Purely decorative. */
export default function ShootingStars({ count, seed }: { count: number; seed: string }) {
  const streaks = useMemo(() => planShootingStars(count, seed), [count, seed]);
  if (streaks.length === 0) return null;

  return (
    <div aria-hidden="true" className="shooting-stars">
      {streaks.map((streak, index) => (
        <span
          key={index}
          className="shooting-star"
          style={
            {
              top: `${streak.top}%`,
              left: `${streak.left}%`,
              width: streak.length,
              animationDuration: `${streak.duration}s`,
              animationDelay: `${streak.delay}s`,
              "--shooting-angle": `${streak.angle}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
