import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import { db } from "@/services/firebase";
import { getActiveOrCreateInitialConstellation } from "@/services/constellations";
import { withTimeout } from "@/services/firestore";
import { DUST_COLOR_PALETTE } from "@/lib/dust";

const QUERY_MS = 30_000;
const CREATE_MS = 30_000;
const DUST_COUNT_FIELD = "awardedDustCount";

export async function createDustForCardReview(userId: string, cardId: string) {
  const activeConstellation = await getActiveOrCreateInitialConstellation(userId);
  if (!activeConstellation) {
    return null;
  }

  const dustCollection = collection(db, "users", userId, "dust");
  const dustRef = doc(dustCollection);
  const constellationRef = doc(
    db,
    "users",
    userId,
    "constellations",
    activeConstellation.id
  );
  const constellationDustSnapshot = await withTimeout(
    getDocs(
      query(
        dustCollection,
        where("constellationId", "==", activeConstellation.id)
      )
    ),
    QUERY_MS,
    "Load constellation dust"
  );
  const initialConstellationDustCount = constellationDustSnapshot.size;

  if (initialConstellationDustCount >= activeConstellation.maxDust) {
    return null;
  }

  const createdAt = Date.now();
  const dust = {
    cardId,
    constellationId: activeConstellation.id,
    position: {
      x: Math.random() * 96 + 2,
      y: Math.random() * 96 + 2,
    },
    size: Math.random() * (2.3 - 1.1) + 1.1,
    opacity: Math.random() * (0.34 - 0.16) + 0.16,
    color: DUST_COLOR_PALETTE[
      Math.floor(Math.random() * DUST_COLOR_PALETTE.length)
    ],

    createdAt,
  };

  const didCreate = await withTimeout(
    runTransaction(db, async (transaction) => {
      const constellationSnapshot = await transaction.get(constellationRef);
      if (!constellationSnapshot.exists()) {
        return false;
      }

      const constellationData = constellationSnapshot.data() as Record<string, unknown>;
      const maxDust =
        typeof constellationData.maxDust === "number" && constellationData.maxDust > 0
          ? constellationData.maxDust
          : activeConstellation.maxDust;
      const currentCount =
        typeof constellationData[DUST_COUNT_FIELD] === "number"
          ? (constellationData[DUST_COUNT_FIELD] as number)
          : initialConstellationDustCount;

      if (currentCount >= maxDust) {
        return false;
      }

      transaction.set(dustRef, dust);
      transaction.update(constellationRef, {
        [DUST_COUNT_FIELD]: currentCount + 1,
      });

      return true;
    }),
    CREATE_MS,
    "Create dust"
  );

  if (!didCreate) {
    return null;
  }

  return {
    id: dustRef.id,
    ...dust,
  };
}
