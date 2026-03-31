export const MAX_STARS_PER_CONSTELLATION = 40;
export const MAX_DUST_PER_CONSTELLATION = 400;

export type ConstellationStatus = "active" | "finished";

export type Constellation = {
  id: string;
  name: string;
  status: ConstellationStatus;
  maxStars: number;
  maxDust: number;
  createdAt: number;
  finishedAt?: number;
};

export type ConstellationProgress = {
  starCount: number;
  dustCount: number;
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
    maxDust:
      typeof data.maxDust === "number" && data.maxDust > 0
        ? data.maxDust
        : MAX_DUST_PER_CONSTELLATION,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : Date.now(),
    finishedAt:
      typeof data.finishedAt === "number" ? data.finishedAt : undefined,
  };
}

export function getActiveConstellation(constellations: Constellation[]) {
  return constellations.find((constellation) => constellation.status === "active") ?? null;
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

export function buildConstellationProgressMap(
  constellationIds: string[],
  stars: Array<{ constellationId: string }>,
  dustParticles: Array<{ constellationId: string }>
) {
  const progressMap: Record<string, ConstellationProgress> = {};

  constellationIds.forEach((constellationId) => {
    progressMap[constellationId] = {
      starCount: 0,
      dustCount: 0,
    };
  });

  stars.forEach((star) => {
    if (!star.constellationId) return;

    progressMap[star.constellationId] = progressMap[star.constellationId] ?? {
      starCount: 0,
      dustCount: 0,
    };
    progressMap[star.constellationId].starCount += 1;
  });

  dustParticles.forEach((particle) => {
    if (!particle.constellationId) return;

    progressMap[particle.constellationId] = progressMap[particle.constellationId] ?? {
      starCount: 0,
      dustCount: 0,
    };
    progressMap[particle.constellationId].dustCount += 1;
  });

  return progressMap;
}

export function isConstellationReadyToFinish(
  constellation: Constellation,
  progress?: ConstellationProgress
) {
  if (!progress) {
    return false;
  }

  return (
    progress.starCount >= constellation.maxStars &&
    progress.dustCount >= constellation.maxDust
  );
}
