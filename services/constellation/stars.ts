import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { getActiveOrCreateInitialConstellation } from "@/services/constellation/constellations";
import type { Goal } from "@/lib/study/goals";
import { getStarColor, getStarRewardSize, resolveStarPresetId } from "@/lib/constellation/stars";
import type { NormalizedStar } from "@/lib/constellation/stars";
import { withTimeout } from "@/services/firebase/firestore";

const QUERY_MS = 30_000;
const CREATE_MS = 30_000;
const UPDATE_MS = 30_000;
const STAR_COUNT_FIELD = "starCount";

export async function backfillStarPositions(
  userId: string,
  stars: NormalizedStar[]
) {
  const starsNeedingBackfill = stars.filter((star) => star.needsBackfill);

  if (starsNeedingBackfill.length === 0) {
    return;
  }

  await withTimeout(
    Promise.all(
      starsNeedingBackfill.map((star) =>
        updateDoc(doc(db, "users", userId, "stars", star.id), {
          position: star.position,
        })
      )
    ),
    UPDATE_MS,
    "Backfill star positions"
  );
}

export async function createStarForGoalIfMissing(userId: string, goal: Goal) {
  const starsCollection = collection(db, "users", userId, "stars");
  const starRef = doc(starsCollection, goal.id);
  const existingStarSnapshot = await withTimeout(
    getDocs(query(starsCollection, where("goalId", "==", goal.id))),
    QUERY_MS,
    "Load existing quest star"
  );

  if (!existingStarSnapshot.empty) {
    return null;
  }

  const activeConstellation = await getActiveOrCreateInitialConstellation(userId);
  if (!activeConstellation) {
    return null;
  }

  const constellationRef = doc(
    db,
    "users",
    userId,
    "constellations",
    activeConstellation.id
  );

  const constellationStarsSnapshot = await withTimeout(
    getDocs(
      query(starsCollection, where("constellationId", "==", activeConstellation.id))
    ),
    QUERY_MS,
    "Load constellation stars"
  );
  const initialConstellationStarCount = constellationStarsSnapshot.size;

  if (initialConstellationStarCount >= activeConstellation.maxStars) {
    return null;
  }

  const completedGoalsSnapshot = await withTimeout(
    getDocs(
      query(
        collection(db, "users", userId, "goals"),
        where("status", "==", "completed")
      )
    ),
    QUERY_MS,
    "Load completed goals"
  );

  const completedGoalsCount = completedGoalsSnapshot.size;
  const createdAt = Date.now();

  const presetId = resolveStarPresetId(goal);
  const star = {
    goalId: goal.id,
    constellationId: activeConstellation.id,
    size: getStarRewardSize(goal.targetCards),
    glow: goal.targetAccuracy,
    color: getStarColor(completedGoalsCount),
    presetId,
    position: {
      x: 10 + Math.random() * 80,
      y: 10 + Math.random() * 80,
    },
    createdAt,
  };

  const didCreate = await withTimeout(
    runTransaction(db, async (transaction) => {
      const [constellationSnapshot, starSnapshot] = await Promise.all([
        transaction.get(constellationRef),
        transaction.get(starRef),
      ]);

      if (!constellationSnapshot.exists() || starSnapshot.exists()) {
        return false;
      }

      const constellationData = constellationSnapshot.data() as Record<string, unknown>;
      const maxStars =
        typeof constellationData.maxStars === "number" && constellationData.maxStars > 0
          ? constellationData.maxStars
          : activeConstellation.maxStars;
      const currentCount =
        typeof constellationData[STAR_COUNT_FIELD] === "number"
          ? (constellationData[STAR_COUNT_FIELD] as number)
          : initialConstellationStarCount;

      if (currentCount >= maxStars) {
        return false;
      }

      transaction.set(starRef, star);
      transaction.update(constellationRef, {
        [STAR_COUNT_FIELD]: currentCount + 1,
      });

      return true;
    }),
    CREATE_MS,
    "Create star"
  );

  if (!didCreate) {
    return null;
  }

  return {
    id: starRef.id,
    ...star,
  };
}

export async function saveStarPosition(
  userId: string,
  starId: string,
  position: { x: number; y: number }
) {
  await withTimeout(
    updateDoc(doc(db, "users", userId, "stars", starId), {
      position,
    }),
    UPDATE_MS,
    "Save star position"
  );
}
