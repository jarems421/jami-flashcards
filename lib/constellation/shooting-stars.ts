/**
 * Shooting stars across a sky, more of them the more stars it holds.
 *
 * A sky with a handful of earned stars gets the occasional streak; a full one
 * gets a steady scatter of them. Each streak is visible for under two seconds
 * of its cycle, falls somewhere new every time, and now and then two or three
 * fall together -- which is what a real meteor shower looks like, and what a
 * row of evenly spaced streaks in one corner did not.
 */

export type ShootingStarSurface = "sky" | "background";

const LIMITS: Record<ShootingStarSurface, { max: number; starsPerStreak: number }> = {
  // The constellation page, where the sky is the subject.
  sky: { max: 8, starsPerStreak: 5 },
  // Behind the app, where it is atmosphere: fewer, and slower to grow.
  background: { max: 5, starsPerStreak: 8 },
};

/** The sign-in pages and the welcome, which have no stars of their own to count. */
export const NIGHT_SKY_SHOOTING_STARS = 4;

export function getShootingStarCount(starCount: number, surface: ShootingStarSurface) {
  if (!Number.isFinite(starCount) || starCount <= 0) return 0;
  const { max, starsPerStreak } = LIMITS[surface];
  return Math.min(max, 1 + Math.floor(starCount / starsPerStreak));
}

/** When a streak falls. Every streak in a sky shares one cycle, so groups stay together. */
export type ShootingStarTiming = {
  duration: number;
  delay: number;
};

/** Where one fall of a streak happens. */
export type ShootingStarPath = {
  /** Where the streak starts, as percentages of the sky. */
  top: number;
  left: number;
  /** Degrees below the horizontal it falls at. */
  angle: number;
  /** Length in pixels. */
  length: number;
  /** How far it travels while visible, in pixels. */
  travel: number;
  /** The colour it burns: mostly pale violet, now and then ice, green or gold. */
  tint: ShootingStarTint;
  /** A rare, brighter, longer streak that flares before it goes out. */
  fireball: boolean;
};

export type ShootingStarTint = "violet" | "ice" | "green" | "gold";

const TINTS: { tint: ShootingStarTint; weight: number }[] = [
  { tint: "violet", weight: 0.5 },
  { tint: "ice", weight: 0.3 },
  { tint: "green", weight: 0.12 },
  { tint: "gold", weight: 0.08 },
];

function pickTint(roll: number): ShootingStarTint {
  let total = 0;
  for (const { tint, weight } of TINTS) {
    total += weight;
    if (roll < total) return tint;
  }
  return "violet";
}

export type ShootingStarPlan = ShootingStarTiming & ShootingStarPath;

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

/**
 * When each streak falls.
 *
 * Streaks are dealt into fewer slots than there are streaks, so once a sky has
 * a few of them some slots hold two or three that fall within a moment of each
 * other, and the rest fall alone.
 */
export function planShootingStarTimings(count: number, seed: string): ShootingStarTiming[] {
  const total = Math.max(0, Math.floor(count));
  const random = seeded(hashOf(`${seed}:timing`));
  const duration = Math.round((16 + random() * 4) * 10) / 10;
  const slots = Math.max(1, Math.ceil(total * 0.6));
  const slotOffsets = Array.from({ length: slots }, (_, slot) => (slot / slots) * duration + random() * 1.5);
  return Array.from({ length: total }, (_, index) => ({
    duration,
    delay: Math.round((slotOffsets[index % slots] + random() * 0.6) * 10) / 10,
  }));
}

/** Where a streak falls on a given pass: anywhere across the sky, and different each pass. */
export function planShootingStarPath(seed: string, index: number, pass: number): ShootingStarPath {
  const random = seeded(hashOf(`${seed}:${index}:${pass}`));
  const top = Math.round(random() * 70 * 10) / 10;
  const left = Math.round((15 + random() * 85) * 10) / 10;
  const angle = Math.round((14 + random() * 20) * 10) / 10;
  const baseLength = 90 + random() * 90;
  const fireball = random() < 0.14;
  const length = Math.round(baseLength * (fireball ? 1.6 : 1));
  return {
    top,
    left,
    angle,
    length,
    travel: Math.round(length * (1.7 + random() * 0.8)),
    tint: pickTint(random()),
    fireball,
  };
}

/** The first pass of every streak, for the same sky always the same. */
export function planShootingStars(count: number, seed: string): ShootingStarPlan[] {
  return planShootingStarTimings(count, seed).map((timing, index) => ({
    ...timing,
    ...planShootingStarPath(seed, index, 0),
  }));
}
