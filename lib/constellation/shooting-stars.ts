/**
 * Shooting stars across a sky, more of them the more stars it holds.
 *
 * A sky with a handful of earned stars gets the occasional streak; a full one
 * gets a few more, but never enough to pull the eye from the work. Each streak
 * is visible for well under two seconds of a cycle lasting over twenty, and
 * they are spread through that cycle so two rarely cross at once.
 */

export type ShootingStarSurface = "sky" | "background";

const LIMITS: Record<ShootingStarSurface, { max: number; starsPerStreak: number }> = {
  // The constellation page, where the sky is the subject.
  sky: { max: 4, starsPerStreak: 10 },
  // Behind the app, where it is atmosphere: half as many, and slower to grow.
  background: { max: 2, starsPerStreak: 16 },
};

export function getShootingStarCount(starCount: number, surface: ShootingStarSurface) {
  if (!Number.isFinite(starCount) || starCount <= 0) return 0;
  const { max, starsPerStreak } = LIMITS[surface];
  return Math.min(max, 1 + Math.floor(starCount / starsPerStreak));
}

export type ShootingStarPlan = {
  /** Where the streak starts, as percentages of the sky. */
  top: number;
  left: number;
  /** Degrees below the horizontal it falls at. */
  angle: number;
  /** Length in pixels. */
  length: number;
  /** One full cycle, of which the streak is visible for the last few percent. */
  duration: number;
  delay: number;
};

function hashOf(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same streaks for the same sky, so nothing reshuffles between renders. */
export function planShootingStars(count: number, seed: string): ShootingStarPlan[] {
  const random = seeded(hashOf(seed));
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => {
    const duration = 20 + random() * 8;
    return {
      top: 4 + random() * 48,
      left: 35 + random() * 60,
      angle: 16 + random() * 16,
      length: 90 + random() * 80,
      duration: Math.round(duration * 10) / 10,
      // Spread through the cycle, so they take turns rather than falling together.
      delay: Math.round(((index / Math.max(1, count)) * duration + random() * 3) * 10) / 10,
    };
  });
}
