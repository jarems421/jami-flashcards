export const MAX_STARS_PER_CONSTELLATION = 40;

/**
 * How many lines one constellation may hold.
 *
 * Forty stars can be joined 780 ways, and every line lives in the same
 * Firestore document as the constellation itself. This is far more than any
 * figure needs -- the Plough is six -- and low enough that the document cannot
 * be grown into a problem by someone tapping quickly.
 */
export const MAX_LINES_PER_CONSTELLATION = 120;

/**
 * A line joining two stars, stored with its ends in a fixed order.
 *
 * A line has no direction: joining A to B is the same line as joining B to A.
 * Sorting the pair on the way in is what makes that true in the data as well as
 * in the drawing, so a duplicate is a string comparison rather than a search.
 */
export type ConstellationLine = { a: string; b: string };

export type ConstellationStatus = "active" | "finished";

export type Constellation = {
  id: string;
  name: string;
  status: ConstellationStatus;
  maxStars: number;
  starCount: number;
  lines: ConstellationLine[];
  createdAt: number;
  finishedAt?: number;
};

export function normalizeConstellationLines(value: unknown): ConstellationLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const lines: ConstellationLine[] = [];

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { a, b } = entry as { a?: unknown; b?: unknown };
    if (typeof a !== "string" || typeof b !== "string") continue;
    if (!a || !b || a === b) continue;

    const [first, second] = a < b ? [a, b] : [b, a];
    const key = `${first}__${second}`;
    if (seen.has(key)) continue;

    seen.add(key);
    lines.push({ a: first, b: second });
    if (lines.length >= MAX_LINES_PER_CONSTELLATION) break;
  }

  return lines;
}

/**
 * Joins two stars, or unjoins them if they are already joined.
 *
 * One function for both directions because there is one gesture for both: in
 * Connect mode, drawing between two stars that are already joined is how a line
 * is taken back. Returning the same array when nothing changed lets callers
 * skip a write.
 */
export function toggleConstellationLine(
  lines: ConstellationLine[],
  starA: string,
  starB: string
): ConstellationLine[] {
  if (!starA || !starB || starA === starB) {
    return lines;
  }

  const [a, b] = starA < starB ? [starA, starB] : [starB, starA];
  const existing = lines.findIndex((line) => line.a === a && line.b === b);

  if (existing >= 0) {
    return lines.filter((_, index) => index !== existing);
  }

  if (lines.length >= MAX_LINES_PER_CONSTELLATION) {
    return lines;
  }

  return [...lines, { a, b }];
}

/**
 * Drops any line whose stars are no longer in the sky.
 *
 * A line outlives the star it points at -- deleting a star, or a backfill
 * moving one to another constellation, leaves an edge pointing at nothing. It
 * is filtered at the point of drawing rather than repaired in the database,
 * because a star that disappears from one read can come back in the next.
 */
export function getDrawableConstellationLines(
  lines: ConstellationLine[],
  starIds: Iterable<string>
): ConstellationLine[] {
  const present = new Set(starIds);
  return lines.filter((line) => present.has(line.a) && present.has(line.b));
}

export function normalizeConstellation(
  id: string,
  data: Record<string, unknown>
): Constellation {
  return {
    id,
    name:
      typeof data.name === "string" && data.name.trim()
        ? data.name
        : "Unnamed Constellation",
    status: data.status === "finished" ? "finished" : "active",
    maxStars:
      typeof data.maxStars === "number" && data.maxStars > 0
        ? data.maxStars
        : MAX_STARS_PER_CONSTELLATION,
    lines: normalizeConstellationLines(data.lines),
    starCount:
      typeof data.starCount === "number" && data.starCount >= 0
        ? data.starCount
        : typeof data.awardedStarsCount === "number" && data.awardedStarsCount >= 0
          ? data.awardedStarsCount
          : 0,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    finishedAt:
      typeof data.finishedAt === "number" ? data.finishedAt : undefined,
  };
}

export function getActiveConstellation(constellations: Constellation[]) {
  return (
    constellations.find((constellation) => constellation.status === "active") ??
    null
  );
}

export function getFallbackConstellation(constellations: Constellation[]) {
  return getActiveConstellation(constellations) ?? constellations[0] ?? null;
}

export function getResolvedBackgroundConstellation(
  constellations: Constellation[],
  requestedConstellationId?: string | null
) {
  if (requestedConstellationId) {
    const requestedConstellation = constellations.find(
      (constellation) => constellation.id === requestedConstellationId
    );

    if (requestedConstellation) {
      return requestedConstellation;
    }
  }

  return getFallbackConstellation(constellations);
}

export function isConstellationReadyToFinish(constellation: Constellation) {
  return constellation.starCount >= constellation.maxStars;
}
