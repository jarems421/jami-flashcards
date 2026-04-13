import type { Goal } from "@/lib/study/goals";

export type StarPresetId =
  | "classic"
  | "blue-spark"
  | "gold-burst"
  | "violet-comet"
  | "magenta-elite";

export type StarPosition = {
  x: number;
  y: number;
};

export type Star = {
  id: string;
  goalId: string;
  constellationId: string;
  size: number;
  glow: number;
  color: string;
  position: StarPosition;
  createdAt: number;
  name?: string;
  presetId?: StarPresetId;
};

export type NormalizedStar = Star & {
  needsBackfill: boolean;
  isLegacyStar?: boolean;
};

const STAR_VISUAL_MIN_TARGET_CARDS = 1;
const STAR_VISUAL_REFERENCE_TARGET_CARDS = 500;
const STAR_MIN_VISUAL_SIZE = 18;
const STAR_MAX_VISUAL_SIZE = 52;
const STAR_SIZE_CURVE_EXPONENT = 2.9;

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function areTooClose(a: StarPosition, b: StarPosition) {
  return Math.abs(a.x - b.x) < 8 && Math.abs(a.y - b.y) < 8;
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getSeededRandom(value: string, index: number) {
  const seed = hashString(`${value}:${index}`);
  const random = Math.sin(seed * 9301 + index * 49297) * 233280;
  return random - Math.floor(random);
}

function getDeterministicPositionValue(value: string, index: number) {
  return 10 + getSeededRandom(value, index) * 80;
}

export function getStarColor(completedGoalsCount: number) {
  if (completedGoalsCount >= 10) {
    return "gold";
  }

  if (completedGoalsCount >= 5) {
    return "blue";
  }

  return "white";
}

const STAR_PRESET_ICON_MAP: Record<StarPresetId, string> = {
  classic: "constellation/star.png",
  "blue-spark": "constellation/star.png",
  "gold-burst": "constellation/star.png",
  "violet-comet": "constellation/star.png",
  "magenta-elite": "constellation/star.png",
};

export function getStarPresetIconPath(presetId?: StarPresetId): string | null {
  return presetId ? `/images/${STAR_PRESET_ICON_MAP[presetId]}` : null;
}

export function resolveStarPresetId(goal: Goal): StarPresetId {
  void goal;
  return "classic";
}

function getDefaultStarPosition(seed = "default-star"): StarPosition {
  return {
    x: getDeterministicPositionValue(seed, 1),
    y: getDeterministicPositionValue(seed, 2),
  };
}

export function getStarRewardSize(targetCards: number) {
  return Math.log(Math.max(0, targetCards) + 1);
}

export function getStarVisualSize(starSize: number) {
  const minRewardSize = getStarRewardSize(STAR_VISUAL_MIN_TARGET_CARDS);
  const maxRewardSize = getStarRewardSize(STAR_VISUAL_REFERENCE_TARGET_CARDS);
  const normalizedSize = clampNumber(
    maxRewardSize > minRewardSize
      ? (starSize - minRewardSize) / (maxRewardSize - minRewardSize)
      : 0,
    0,
    1
  );
  const curvedSize = normalizedSize ** STAR_SIZE_CURVE_EXPONENT;

  return (
    STAR_MIN_VISUAL_SIZE +
    curvedSize * (STAR_MAX_VISUAL_SIZE - STAR_MIN_VISUAL_SIZE)
  );
}

function getLegacyStarVisualSize(starSize: number) {
  const normalizedSize = clampNumber(starSize, 0, 1);
  return (
    STAR_MIN_VISUAL_SIZE +
    normalizedSize * (STAR_MAX_VISUAL_SIZE - STAR_MIN_VISUAL_SIZE)
  );
}

export function getEffectiveStarVisualSize(star: {
  size: number;
  presetId?: StarPresetId;
  isLegacyStar?: boolean;
}) {
  const shouldUseLegacyScale =
    star.isLegacyStar &&
    star.size >= 0 &&
    star.size <= 1;

  return shouldUseLegacyScale
    ? getLegacyStarVisualSize(star.size)
    : getStarVisualSize(star.size);
}

function inferStarPresetIdFromLegacyValues(
  starSize: number,
  starGlow: number
): StarPresetId {
  const inferredTargetCards = Math.max(0, Math.round(Math.exp(starSize) - 1));

  return resolveStarPresetId(
    {
      id: "legacy-star",
      deadline: 0,
      progress: {
        cardsCompleted: 0,
        correctAnswers: 0,
        totalAnswers: 0,
      },
      status: "active",
      createdAt: Date.now(),
      targetCards: inferredTargetCards,
      targetAccuracy: starGlow,
    } as Goal
  );
}

export function getEffectiveStarPresetId(star: {
  presetId?: StarPresetId;
  size: number;
  glow: number;
}): StarPresetId {
  return star.presetId ?? inferStarPresetIdFromLegacyValues(star.size, star.glow);
}

export function buildPreviewStar({
  targetCards,
  targetAccuracy,
  completedGoalsCount,
  constellationId = "preview-constellation",
  id = "preview-star",
  goalId = "preview-goal",
  createdAt = 0,
  position = { x: 50, y: 50 },
  presetId,
}: {
  targetCards: number;
  targetAccuracy: number;
  completedGoalsCount: number;
  constellationId?: string;
  id?: string;
  goalId?: string;
  createdAt?: number;
  position?: StarPosition;
  presetId?: StarPresetId;
}) {
  return normalizeStar({
    id,
    goalId,
    constellationId,
    size: getStarRewardSize(targetCards),
    glow: targetAccuracy,
    color: getStarColor(completedGoalsCount),
    createdAt,
    position,
    presetId: presetId ?? "classic",
  });
}

export function normalizeStar(star: {
  id: string;
  goalId: string;
  constellationId?: string;
  size: number;
  glow: number;
  color: string;
  createdAt: number;
  position?: Partial<StarPosition>;
  presetId?: StarPresetId;
  name?: string;
}): NormalizedStar {
  const hasValidPosition =
    typeof star.position?.x === "number" &&
    typeof star.position?.y === "number";
  const existingPosition = star.position;
  const position = hasValidPosition
    ? {
        x: existingPosition!.x!,
        y: existingPosition!.y!,
      }
    : getDefaultStarPosition(star.id);

  return {
    ...star,
    constellationId: typeof star.constellationId === "string" ? star.constellationId : "",
    position,
    needsBackfill: !hasValidPosition,
    name: typeof star.name === "string" ? star.name : undefined,
    isLegacyStar: star.presetId === undefined,
    presetId:
      star.presetId ?? inferStarPresetIdFromLegacyValues(star.size, star.glow),
  };
}

export function parseStarData(
  id: string,
  data: Record<string, unknown>
): NormalizedStar {
  return normalizeStar({
    id,
    goalId: typeof data.goalId === "string" ? data.goalId : "",
    constellationId:
      typeof data.constellationId === "string" ? data.constellationId : "",
    size: typeof data.size === "number" ? data.size : 0,
    glow: typeof data.glow === "number" ? data.glow : 0,
    color: typeof data.color === "string" ? data.color : "white",
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
    name: typeof data.name === "string" ? data.name : undefined,
    position:
      typeof data.position === "object" && data.position !== null
        ? (data.position as Partial<StarPosition>)
        : undefined,
    presetId:
      typeof data.presetId === "string"
        ? (data.presetId as StarPresetId)
        : undefined,
  });
}

export function spreadBackfilledStars(stars: NormalizedStar[]) {
  const placed: StarPosition[] = [];

  return stars.map((star) => {
    if (!star.needsBackfill) {
      placed.push(star.position);
      return star;
    }

    let nextPosition = star.position;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const overlaps = placed.some((position) => areTooClose(position, nextPosition));
      if (!overlaps) break;

      nextPosition = {
        x: clampPercentage(nextPosition.x + 10),
        y: clampPercentage(nextPosition.y + 10),
      };
    }

    placed.push(nextPosition);

    return {
      ...star,
      position: nextPosition,
    };
  });
}


