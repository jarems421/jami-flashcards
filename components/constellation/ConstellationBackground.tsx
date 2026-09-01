"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { listenToAuth } from "@/services/auth/auth-listener";
import {
  getResolvedBackgroundConstellation,
  type Constellation,
} from "@/lib/constellation/constellations";
import { ensureConstellationSetup } from "@/services/constellation/constellations";
import {
  spreadBackfilledStars,
  type NormalizedStar,
} from "@/lib/constellation/stars";
import { backfillStarPositions, getStars } from "@/services/constellation/stars";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import ConstellationLines from "@/components/constellation/ConstellationLines";

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
        const stars = await getStars(user.uid);
        if (cancelled) return;

        const adjustedStars = spreadBackfilledStars(
          stars
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
      {/*
        * The stars, with nothing on top of them.
        *
        * There were two dimmers here -- a 0.96 wrapper and an 8 per cent dark
        * veil over the field -- on top of the star's own 0.88 and the app
        * overlay at 0.2. Each is small; multiplied together they took the glow,
        * which is a soft shadow at low alpha to begin with, down to nothing,
        * and squeezed the twinkle into a range too narrow to see. The stars
        * read as flat dots.
        *
        * Dimming belongs to the one overlay that already exists for it, not to
        * three more that each look harmless on their own.
        */}
      <div className="constellation-sky-layer absolute inset-0 z-10">
        {/*
          * The pattern follows the sky wherever it is drawn.
          *
          * A figure someone drew out of their own goals is the point of drawing
          * it; showing it only on the page where it was made would be the same
          * mistake as the sky having one star in the reward and another in the
          * constellation. Fainter here than on that page, because behind a
          * working surface it is atmosphere rather than the subject.
          */}
        <ConstellationLines
          lines={selectedConstellation?.lines ?? []}
          stars={visibleStars}
          variant="background"
        />
        {visibleStars.map((star) => (
          <ConstellationStar key={star.id} star={star} variant="background" />
        ))}
      </div>
    </div>
  );
}
