import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import {
  getActiveConstellation,
  MAX_STARS_PER_CONSTELLATION,
  MAX_NEBULA_PROGRESS_PER_CONSTELLATION,
  normalizeConstellation,
  type Constellation,
} from "@/lib/constellation/constellations";

const QUERY_MS = 30_000;
const CREATE_MS = 30_000;
const UPDATE_MS = 30_000;
const BATCH_DELETE_LIMIT = 400;
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

async function deleteSnapshotsInBatches(
  snapshots: QueryDocumentSnapshot[],
  label: string
) {
  if (snapshots.length === 0) {
    return;
  }

  for (let index = 0; index < snapshots.length; index += BATCH_DELETE_LIMIT) {
    const batch = writeBatch(db);
    const chunk = snapshots.slice(index, index + BATCH_DELETE_LIMIT);

    for (const snapshot of chunk) {
      batch.delete(snapshot.ref);
    }

    await withTimeout(batch.commit(), UPDATE_MS, label);
  }
}

function countLegacyNebulaByConstellation(
  snapshots: QueryDocumentSnapshot[],
  fallbackConstellationId: string
) {
  const counts: Record<string, number> = {};

  for (const snapshot of snapshots) {
    const data = snapshot.data() as Record<string, unknown>;
    const constellationId =
      typeof data.constellationId === "string" && data.constellationId.trim()
        ? data.constellationId
        : fallbackConstellationId;

    if (!constellationId) {
      continue;
    }

    counts[constellationId] = (counts[constellationId] ?? 0) + 1;
  }

  return counts;
}

async function migrateConstellationSchema(
  userId: string,
  constellationDocs: QueryDocumentSnapshot[],
  legacyNebulaCounts: Record<string, number>
) {
  const migratedConstellations = constellationDocs.map((constellationDoc) => {
    const data = constellationDoc.data() as Record<string, unknown>;
    const normalized = normalizeConstellation(constellationDoc.id, data);
    const legacyNebulaProgress = legacyNebulaCounts[constellationDoc.id] ?? 0;

    if (legacyNebulaProgress <= normalized.nebulaProgressCount) {
      return normalized;
    }

    return {
      ...normalized,
      nebulaProgressCount: legacyNebulaProgress,
    };
  });

  const updates = constellationDocs.flatMap((constellationDoc) => {
    const data = constellationDoc.data() as Record<string, unknown>;
    const normalized = migratedConstellations.find(
      (constellation) => constellation.id === constellationDoc.id
    );

    if (!normalized) {
      return [];
    }

    const needsMigration =
      typeof data.maxNebulaProgress !== "number" ||
      typeof data.starCount !== "number" ||
      typeof data.nebulaProgressCount !== "number" ||
      "maxDust" in data ||
      "awardedStarsCount" in data ||
      "awardedDustCount" in data;

    if (!needsMigration) {
      return [];
    }

    const nextData: Record<string, unknown> = {
      name: normalized.name,
      status: normalized.status,
      maxStars: normalized.maxStars,
      maxNebulaProgress: normalized.maxNebulaProgress,
      starCount: normalized.starCount,
      nebulaProgressCount: normalized.nebulaProgressCount,
      createdAt: normalized.createdAt,
      maxDust: deleteField(),
      awardedStarsCount: deleteField(),
      awardedDustCount: deleteField(),
    };

    if (normalized.finishedAt !== undefined) {
      nextData.finishedAt = normalized.finishedAt;
    } else if ("finishedAt" in data) {
      nextData.finishedAt = deleteField();
    }

    return [
      updateDoc(
        doc(db, "users", userId, "constellations", constellationDoc.id),
        nextData
      ),
    ];
  });

  if (updates.length > 0) {
    await withTimeout(
      Promise.all(updates),
      UPDATE_MS,
      "Migrate constellation schema"
    );
  }

  return sortConstellations(migratedConstellations);
}

async function cleanupLegacyDust(
  userId: string,
  fallbackConstellationId: string
) {
  const snapshot = await withTimeout(
    getDocs(collection(db, "users", userId, "dust")),
    QUERY_MS,
    "Load legacy dust"
  );

  if (snapshot.empty) {
    return {};
  }

  const counts = countLegacyNebulaByConstellation(
    snapshot.docs,
    fallbackConstellationId
  );

  await deleteSnapshotsInBatches(snapshot.docs, "Delete legacy dust");

  return counts;
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
    getActiveConstellation(normalizedConstellations)?.id ?? "";
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
    maxStars: MAX_STARS_PER_CONSTELLATION,
    maxNebulaProgress: MAX_NEBULA_PROGRESS_PER_CONSTELLATION,
    starCount: 0,
    nebulaProgressCount: 0,
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
    maxStars: MAX_STARS_PER_CONSTELLATION,
    maxNebulaProgress: MAX_NEBULA_PROGRESS_PER_CONSTELLATION,
    starCount: 0,
    nebulaProgressCount: 0,
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

const MAX_NAME_LENGTH = 40;

export async function renameConstellation(
  userId: string,
  constellationId: string,
  name: string
) {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  if (!trimmed) {
    throw new Error("Constellation name cannot be empty.");
  }
  const constellationRef = doc(
    db,
    "users",
    userId,
    "constellations",
    constellationId
  );
  await withTimeout(
    updateDoc(constellationRef, { name: trimmed }),
    UPDATE_MS,
    "Rename constellation"
  );
  return trimmed;
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

  const initiallyNormalized = sortConstellations(
    snapshot.docs.map((constellationDoc) =>
      normalizeConstellation(
        constellationDoc.id,
        constellationDoc.data() as Record<string, unknown>
      )
    )
  );
  const fallbackConstellationId =
    getActiveConstellation(initiallyNormalized)?.id ??
    initiallyNormalized[0]?.id ??
    INITIAL_CONSTELLATION_ID;
  const legacyNebulaCounts = await cleanupLegacyDust(
    userId,
    fallbackConstellationId
  );
  const normalizedConstellations = await migrateConstellationSchema(
    userId,
    snapshot.docs,
    legacyNebulaCounts
  );

  return enforceSingleActiveConstellation(userId, normalizedConstellations);
}

async function deleteFinishedConstellations(
  userId: string,
  constellations: Constellation[]
) {
  const finishedConstellations = constellations.filter(
    (c) => c.status === "finished"
  );

  if (finishedConstellations.length === 0) {
    return constellations;
  }

  const starsCollection = collection(db, "users", userId, "stars");

  await Promise.all(
    finishedConstellations.map(async (constellation) => {
      const starsSnapshot = await withTimeout(
        getDocs(
          query(
            starsCollection,
            where("constellationId", "==", constellation.id)
          )
        ),
        QUERY_MS,
        "Load finished constellation stars"
      );

      await deleteSnapshotsInBatches(
        starsSnapshot.docs,
        "Delete finished constellation stars"
      );

      await withTimeout(
        deleteDoc(
          doc(db, "users", userId, "constellations", constellation.id)
        ),
        UPDATE_MS,
        "Delete finished constellation"
      );
    })
  );

  return constellations.filter((c) => c.status !== "finished");
}

export async function getActiveOrCreateInitialConstellation(userId: string) {
  const constellations = await getConstellations(userId);
  return getActiveConstellation(constellations);
}

export async function backfillLegacyStarsToConstellation(
  userId: string,
  constellationId: string
) {
  const starsSnapshot = await withTimeout(
    getDocs(collection(db, "users", userId, "stars")),
    QUERY_MS,
    "Load legacy stars"
  );

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

  if (updates.length > 0) {
    await withTimeout(
      Promise.all(updates),
      UPDATE_MS,
      "Backfill legacy stars"
    );
  }
}

export async function ensureConstellationSetup(userId: string) {
  const constellations = await getConstellations(userId);
  const cleaned = await deleteFinishedConstellations(userId, constellations);

  // If all constellations were finished and deleted, re-query to trigger
  // initial constellation creation (getConstellations auto-creates when empty).
  const result =
    cleaned.length > 0 ? cleaned : await getConstellations(userId);

  const activeConstellation = getActiveConstellation(result);

  if (activeConstellation) {
    await backfillLegacyStarsToConstellation(userId, activeConstellation.id);
  }

  return result;
}

