import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/services/firebase";
import { withTimeout } from "@/services/firestore";
import { normalizeConstellation, type Constellation } from "@/lib/constellations";

const QUERY_MS = 30_000;
const CREATE_MS = 30_000;
const UPDATE_MS = 30_000;
const DEFAULT_MAX_STARS = 40;
const DEFAULT_MAX_DUST = 400;
export const INITIAL_CONSTELLATION_ID = "initial";
const ACTIVE_CONSTELLATION_STATE_DOC_ID = "active";

function getActiveConstellationStateRef(userId: string) {
  return doc(
    db,
    "users",
    userId,
    "constellationState",
    ACTIVE_CONSTELLATION_STATE_DOC_ID
  );
}

function getConstellationsCollection(userId: string) {
  return collection(db, "users", userId, "constellations");
}

function getDefaultConstellationName(existingCount: number) {
  return `Constellation ${existingCount + 1}`;
}

function sortConstellations(constellations: Constellation[]) {
  return [...constellations].sort((a, b) => b.createdAt - a.createdAt);
}

async function enforceSingleActiveConstellation(
  userId: string,
  constellations: Constellation[]
) {
  const activeConstellations = constellations.filter(
    (constellation) => constellation.status === "active"
  );
  let normalizedConstellations = constellations;

  if (activeConstellations.length > 1) {
    const [constellationToKeep, ...constellationsToFinish] = activeConstellations;
    const finishedAt = Date.now();

    await withTimeout(
      Promise.all(
        constellationsToFinish.map((constellation) =>
          updateDoc(doc(db, "users", userId, "constellations", constellation.id), {
            status: "finished",
            finishedAt,
          })
        )
      ),
      UPDATE_MS,
      "Repair active constellations"
    );

    normalizedConstellations = constellations.map((constellation) => {
      if (constellation.id === constellationToKeep.id) {
        return constellation;
      }

      if (constellation.status !== "active") {
        return constellation;
      }

      return {
        ...constellation,
        status: "finished" as const,
        finishedAt,
      };
    });
  }

  const activeConstellationId =
    normalizedConstellations.find((constellation) => constellation.status === "active")
      ?.id ?? "";
  const activeStateRef = getActiveConstellationStateRef(userId);
  const activeStateSnapshot = await withTimeout(
    getDoc(activeStateRef),
    QUERY_MS,
    "Load active constellation state"
  );
  const currentActiveId = activeStateSnapshot.exists()
    ? ((activeStateSnapshot.data() as { activeConstellationId?: unknown })
        .activeConstellationId as string | undefined) ?? ""
    : "";

  if (currentActiveId !== activeConstellationId) {
    await withTimeout(
      setDoc(activeStateRef, {
        activeConstellationId,
        updatedAt: Date.now(),
      }),
      UPDATE_MS,
      "Sync active constellation state"
    );
  }

  return normalizedConstellations;
}

async function createInitialConstellation(userId: string) {
  const initialConstellation = {
    name: getDefaultConstellationName(0),
    status: "active" as const,
    maxStars: DEFAULT_MAX_STARS,
    maxDust: DEFAULT_MAX_DUST,
    awardedStarsCount: 0,
    awardedDustCount: 0,
    createdAt: Date.now(),
  };
  const initialConstellationRef = doc(
    db,
    "users",
    userId,
    "constellations",
    INITIAL_CONSTELLATION_ID
  );
  const activeStateRef = getActiveConstellationStateRef(userId);

  await withTimeout(
    runTransaction(db, async (transaction) => {
      const [existingSnapshot, activeStateSnapshot] = await Promise.all([
        transaction.get(initialConstellationRef),
        transaction.get(activeStateRef),
      ]);

      if (!existingSnapshot.exists()) {
        transaction.set(initialConstellationRef, initialConstellation);
      }

      if (!activeStateSnapshot.exists()) {
        transaction.set(activeStateRef, {
          activeConstellationId: INITIAL_CONSTELLATION_ID,
          updatedAt: Date.now(),
        });
      }
    }),
    CREATE_MS,
    "Create initial constellation"
  );

  const initialSnapshot = await withTimeout(
    getDoc(initialConstellationRef),
    QUERY_MS,
    "Load initial constellation"
  );

  if (initialSnapshot.exists()) {
    return normalizeConstellation(
      initialSnapshot.id,
      initialSnapshot.data() as Record<string, unknown>
    );
  }

  return {
    id: initialConstellationRef.id,
    ...initialConstellation,
  };
}

export async function createConstellation(userId: string, name: string) {
  await getConstellations(userId);

  const trimmedName = name.trim();
  const constellationRef = doc(getConstellationsCollection(userId));
  const activeStateRef = getActiveConstellationStateRef(userId);
  const createdAt = Date.now();
  const constellation = {
    name: trimmedName || getDefaultConstellationName(0),
    status: "active" as const,
    maxStars: DEFAULT_MAX_STARS,
    maxDust: DEFAULT_MAX_DUST,
    awardedStarsCount: 0,
    awardedDustCount: 0,
    createdAt,
  };

  await withTimeout(
    runTransaction(db, async (transaction) => {
      const activeStateSnapshot = await transaction.get(activeStateRef);

      if (activeStateSnapshot.exists()) {
        const state = activeStateSnapshot.data() as {
          activeConstellationId?: unknown;
        };
        const activeConstellationId =
          typeof state.activeConstellationId === "string"
            ? state.activeConstellationId
            : "";

        if (activeConstellationId) {
          const activeConstellationRef = doc(
            db,
            "users",
            userId,
            "constellations",
            activeConstellationId
          );
          const activeConstellationSnapshot = await transaction.get(
            activeConstellationRef
          );

          if (activeConstellationSnapshot.exists()) {
            const activeData = activeConstellationSnapshot.data() as {
              status?: unknown;
            };

            if (activeData.status !== "finished") {
              throw new Error(
                "Finish your active constellation before creating a new one."
              );
            }
          }
        }
      }

      transaction.set(constellationRef, constellation);
      transaction.set(activeStateRef, {
        activeConstellationId: constellationRef.id,
        updatedAt: createdAt,
      });
    }),
    CREATE_MS,
    "Create constellation"
  );

  return {
    id: constellationRef.id,
    ...constellation,
  };
}

export async function finishConstellation(userId: string, constellationId: string) {
  const finishedAt = Date.now();
  const constellationRef = doc(db, "users", userId, "constellations", constellationId);
  const activeStateRef = getActiveConstellationStateRef(userId);

  await withTimeout(
    runTransaction(db, async (transaction) => {
      const [constellationSnapshot, activeStateSnapshot] = await Promise.all([
        transaction.get(constellationRef),
        transaction.get(activeStateRef),
      ]);

      if (!constellationSnapshot.exists()) {
        return;
      }

      transaction.update(constellationRef, {
        status: "finished",
        finishedAt,
      });

      if (activeStateSnapshot.exists()) {
        const state = activeStateSnapshot.data() as {
          activeConstellationId?: unknown;
        };

        if (state.activeConstellationId === constellationId) {
          transaction.set(activeStateRef, {
            activeConstellationId: "",
            updatedAt: finishedAt,
          });
        }
      }
    }),
    UPDATE_MS,
    "Finish constellation"
  );

  return finishedAt;
}

export async function getConstellations(userId: string) {
  const snapshot = await withTimeout(
    getDocs(getConstellationsCollection(userId)),
    QUERY_MS,
    "Load constellations"
  );

  if (snapshot.empty) {
    const initialConstellation = await createInitialConstellation(userId);
    return [initialConstellation];
  }

  const normalizedConstellations = sortConstellations(
    snapshot.docs.map((constellationDoc) =>
      normalizeConstellation(
        constellationDoc.id,
        constellationDoc.data() as Record<string, unknown>
      )
    )
  );

  return enforceSingleActiveConstellation(userId, normalizedConstellations);
}

export async function getActiveOrCreateInitialConstellation(userId: string) {
  const constellations = await getConstellations(userId);
  return constellations.find((constellation) => constellation.status === "active") ?? null;
}

export async function backfillLegacyRewardsToConstellation(
  userId: string,
  constellationId: string
) {
  const [starsSnapshot, dustSnapshot] = await Promise.all([
    withTimeout(
      getDocs(collection(db, "users", userId, "stars")),
      QUERY_MS,
      "Load legacy stars"
    ),
    withTimeout(
      getDocs(collection(db, "users", userId, "dust")),
      QUERY_MS,
      "Load legacy dust"
    ),
  ]);

  const updates: Promise<void>[] = [];

  starsSnapshot.docs.forEach((starDoc) => {
    const data = starDoc.data();
    if (typeof data.constellationId === "string" && data.constellationId.trim()) {
      return;
    }

    updates.push(
      updateDoc(starDoc.ref, {
        constellationId,
      })
    );
  });

  dustSnapshot.docs.forEach((dustDoc) => {
    const data = dustDoc.data();
    if (typeof data.constellationId === "string" && data.constellationId.trim()) {
      return;
    }

    updates.push(
      updateDoc(dustDoc.ref, {
        constellationId,
      })
    );
  });

  if (updates.length > 0) {
    await withTimeout(
      Promise.all(updates),
      UPDATE_MS,
      "Backfill legacy rewards"
    );
  }
}

export async function ensureConstellationSetup(userId: string) {
  const constellations = await getConstellations(userId);
  const fallbackConstellation = constellations.find(
    (constellation) => constellation.status === "active"
  );

  if (fallbackConstellation) {
    await backfillLegacyRewardsToConstellation(userId, fallbackConstellation.id);
  }

  return constellations;
}
