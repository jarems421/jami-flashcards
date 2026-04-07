"use client";

import { useEffect, useMemo, useState } from "react";
import { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { listenToAuth } from "@/lib/auth/auth-listener";
import {
  getResolvedBackgroundConstellation,
  type Constellation,
} from "@/lib/constellation/constellations";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import {
  parseStarData,
  spreadBackfilledStars,
  type NormalizedStar,
} from "@/lib/constellation/stars";
import { backfillStarPositions } from "@/services/constellation/stars";
import { db } from "@/services/firebase/client";
import ConstellationStar from "@/components/constellation/ConstellationStar";

type ConstellationBackgroundProps = {
  selectedConstellationId?: string;
};

const MAX_VISIBLE_BACKGROUND_STARS = 60;

export default function ConstellationBackground({
  selectedConstellationId = "",
}: ConstellationBackgroundProps) {
  const [user, setUser] = useState<User | null>(null);
  const [constellations, setConstellations] = useState<Constellation[]>([]);
  const [allStars, setAllStars] = useState<NormalizedStar[]>([]);

  useEffect(() => {
    const unsubscribe = listenToAuth((nextUser) => {
      if (!nextUser) {
        setConstellations([]);
        setAllStars([]);
      }

      setUser(nextUser);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    void (async () => {
      try {
        const nextConstellations = await ensureConstellationSetup(user.uid);
        const starsSnapshot = await getDocs(collection(db, "users", user.uid, "stars"));
        if (cancelled) return;

        const adjustedStars = spreadBackfilledStars(
          starsSnapshot.docs.map((starDoc) =>
            parseStarData(
              starDoc.id,
              starDoc.data() as Record<string, unknown>
            )
          )
        ).sort((a, b) => b.createdAt - a.createdAt);

        setConstellations(nextConstellations);
        setAllStars(adjustedStars);

        if (adjustedStars.some((star) => star.needsBackfill)) {
          await backfillStarPositions(user.uid, adjustedStars);
          if (cancelled) return;

          setAllStars((prev) =>
            prev.map((star) =>
              star.needsBackfill
                ? {
                    ...star,
                    needsBackfill: false,
                  }
                : star
            )
          );
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setConstellations([]);
          setAllStars([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const selectedConstellation = useMemo(
    () =>
      getResolvedBackgroundConstellation(
        constellations,
        selectedConstellationId
      ),
    [constellations, selectedConstellationId]
  );

  const visibleStars = useMemo(() => {
    const constellationId = selectedConstellation?.id ?? "";

    return allStars
      .filter((star) => star.constellationId === constellationId)
      .slice(0, MAX_VISIBLE_BACKGROUND_STARS);
  }, [allStars, selectedConstellation]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{
        backgroundColor: "#04020b",
      }}
    >
      <div className="absolute inset-0 z-10 opacity-[0.96]">
        {visibleStars.map((star) => (
          <ConstellationStar key={star.id} star={star} variant="background" />
        ))}
      </div>
      <div className="absolute inset-0 z-20 bg-[rgba(7,3,18,0.08)]" />
    </div>
  );
}

