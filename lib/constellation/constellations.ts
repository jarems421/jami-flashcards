export const MAX_STARS_PER_CONSTELLATION = 40;
export const MAX_NEBULA_PROGRESS_PER_CONSTELLATION = 400;

export type ConstellationStatus = "active" | "finished";

export type Constellation = {
  id: string;
  name: string;
  status: ConstellationStatus;
  maxStars: number;
  maxNebulaProgress: number;
  starCount: number;
  nebulaProgressCount: number;
  createdAt: number;
  finishedAt?: number;
};

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
    maxNebulaProgress:
      typeof data.maxNebulaProgress === "number" && data.maxNebulaProgress > 0
        ? data.maxNebulaProgress
        : typeof data.maxDust === "number" && data.maxDust > 0
          ? data.maxDust
          : MAX_NEBULA_PROGRESS_PER_CONSTELLATION,
    starCount:
      typeof data.starCount === "number" && data.starCount >= 0
        ? data.starCount
        : typeof data.awardedStarsCount === "number" && data.awardedStarsCount >= 0
          ? data.awardedStarsCount
          : 0,
    nebulaProgressCount:
      typeof data.nebulaProgressCount === "number" && data.nebulaProgressCount >= 0
        ? data.nebulaProgressCount
        : typeof data.awardedDustCount === "number" && data.awardedDustCount >= 0
          ? data.awardedDustCount
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
