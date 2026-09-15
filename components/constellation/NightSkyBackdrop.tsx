"use client";

import { useState } from "react";
import ShootingStars from "@/components/constellation/ShootingStars";
import { NIGHT_SKY_SHOOTING_STARS } from "@/lib/constellation/shooting-stars";

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The night Jami opens on: one glow breathing slowly across the sky, faint
 * twinkling dust, and the occasional shooting star.
 *
 * The same sky sits behind signing in and behind the first-night welcome, so
 * the walkthrough reads as arriving somewhere rather than as a new screen.
 */
export default function NightSkyBackdrop({ fixed = false }: { fixed?: boolean }) {
  const [dust] = useState(() => {
    // Seeded, so the server and the browser draw the same sky.
    const random = seeded(7);
    return Array.from({ length: 150 }, () => ({
      x: random() * 100,
      y: random() * 100,
      size: 0.6 + random() * 1.9,
      delay: random() * 8,
      duration: 3 + random() * 6,
      opacity: 0.2 + random() * 0.65,
    }));
  });

  return (
    <div className={fixed ? "night-backdrop-fixed" : "fn-night"} aria-hidden="true">
      <div className="fn-glow" />
      {dust.map((speck, index) => (
        <span
          key={index}
          className="fn-dust"
          style={{
            left: `${speck.x}%`,
            top: `${speck.y}%`,
            width: speck.size,
            height: speck.size,
            animationDelay: `${speck.delay}s`,
            animationDuration: `${speck.duration}s`,
            ["--fn-dust" as string]: speck.opacity,
          }}
        />
      ))}
      <ShootingStars count={NIGHT_SKY_SHOOTING_STARS} seed="first-night" />
    </div>
  );
}
