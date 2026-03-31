"use client";

import { useEffect, useMemo, useState } from "react";
import { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { listenToAuth } from "@/lib/auth-listener";
import {
  getResolvedBackgroundConstellation,
  type Constellation,
} from "@/lib/constellations";
import { ensureConstellationSetup } from "@/services/constellations";
import type { DustParticle } from "@/lib/dust";
import { normalizeDust } from "@/lib/dust";
import {
  parseStarData,
  spreadBackfilledStars,
  type NormalizedStar,
} from "@/lib/stars";
import { backfillStarPositions } from "@/services/stars";
import { db } from "@/services/firebase";
import ConstellationDust from "@/components/ConstellationDust";
import ConstellationStar from "@/components/constellation-star";

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
  const [allDustParticles, setAllDustParticles] = useState<DustParticle[]>([]);

  useEffect(() => {
    const unsubscribe = listenToAuth((nextUser) => {
      if (!nextUser) {
        setConstellations([]);
        setAllStars([]);
        setAllDustParticles([]);
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
        const [starsSnapshot, dustSnapshot] = await Promise.all([
          getDocs(collection(db, "users", user.uid, "stars")),
          getDocs(collection(db, "users", user.uid, "dust")),
        ]);
        if (cancelled) return;

        const adjustedStars = spreadBackfilledStars(
          starsSnapshot.docs.map((starDoc) =>
            parseStarData(
              starDoc.id,
              starDoc.data() as Record<string, unknown>
            )
          )
        ).sort((a, b) => b.createdAt - a.createdAt);
        const nextDustParticles = dustSnapshot.docs
          .map((dustDoc) =>
            normalizeDust(
              dustDoc.id,
              dustDoc.data() as Record<string, unknown>
            )
          )
          .sort((a, b) => a.createdAt - b.createdAt);

        setConstellations(nextConstellations);
        setAllStars(adjustedStars);
        setAllDustParticles(nextDustParticles);

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
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setConstellations([]);
          setAllStars([]);
          setAllDustParticles([]);
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

  const visibleDustParticles = useMemo(() => {
    const constellationId = selectedConstellation?.id ?? "";

    return allDustParticles.filter(
      (particle) => particle.constellationId === constellationId
    );
  }, [allDustParticles, selectedConstellation]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{
        backgroundImage: `
          radial-gradient(circle at 20% 20%, rgba(88, 164, 255, 0.22), transparent 32%),
          radial-gradient(circle at 80% 30%, rgba(120, 220, 255, 0.14), transparent 30%),
          radial-gradient(circle at 50% 80%, rgba(120, 180, 255, 0.12), transparent 34%)
        `,
        backgroundColor: "#050816",
        backgroundSize: "auto",
        backgroundPosition: "center",
      }}
    >
      <ConstellationDust
        particles={visibleDustParticles}
        constellationId={selectedConstellation?.id}
        status={selectedConstellation?.status}
        maxDust={selectedConstellation?.maxDust}
        mode="background"
        className="z-0"
      />
      <div className="absolute inset-0 z-10 opacity-90">
        {visibleStars.map((star) => (
          <ConstellationStar key={star.id} star={star} variant="background" />
        ))}
      </div>
      <div className="absolute inset-0 z-20 bg-slate-950/18" />
    </div>
  );
}
