export type DustPosition = {
  x: number;
  y: number;
};

export type DustParticle = {
  id: string;
  cardId: string;
  constellationId: string;
  position: DustPosition;
  size: number;
  opacity: number;
  color: string;
  createdAt: number;
};

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

function getDeterministicBetween(value: string, index: number, min: number, max: number) {
  return min + getSeededRandom(value, index) * (max - min);
}

function getDefaultDustPosition(id: string): DustPosition {
  return {
    x: getDeterministicBetween(id, 1, 2, 98),
    y: getDeterministicBetween(id, 2, 2, 98),
  };
}

export const DUST_COLOR_PALETTE = ["#ffffff", "#d9ebff", "#9dc9ff", "#8b7dff", "#c08cff"];

function getDefaultDustColor(id: string) {
  const index = Math.floor(getSeededRandom(id, 3) * DUST_COLOR_PALETTE.length);
  return DUST_COLOR_PALETTE[index] ?? "#ffffff";
}

function getDefaultDustSize(id: string) {
  return getDeterministicBetween(id, 4, 1.1, 2.3);
}

function getDefaultDustOpacity(id: string) {
  return getDeterministicBetween(id, 5, 0.16, 0.34);
}

export function normalizeDust(
  id: string,
  data: Record<string, unknown>
): DustParticle {
  const hasValidPosition =
    typeof data.position === "object" &&
    data.position !== null &&
    typeof (data.position as Partial<DustPosition>).x === "number" &&
    typeof (data.position as Partial<DustPosition>).y === "number";

  return {
    id,
    cardId: typeof data.cardId === "string" ? data.cardId : "",
    constellationId:
      typeof data.constellationId === "string" ? data.constellationId : "",
    position: hasValidPosition
      ? {
          x: (data.position as Partial<DustPosition>).x!,
          y: (data.position as Partial<DustPosition>).y!,
        }
      : getDefaultDustPosition(id),
    size:
      typeof data.size === "number" && data.size > 0
        ? data.size
        : getDefaultDustSize(id),
    opacity:
      typeof data.opacity === "number" && data.opacity > 0
        ? data.opacity
        : getDefaultDustOpacity(id),
    color: typeof data.color === "string" ? data.color : getDefaultDustColor(id),
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
  };
}

