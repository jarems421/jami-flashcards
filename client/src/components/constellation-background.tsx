import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

interface StarData {
  id: string;
  orderIndex: number;
  positionX: number;
  positionY: number;
  rarity: "NORMAL" | "BRIGHT" | "BRILLIANT";
}

interface Constellation {
  id: string;
  name: string;
  isComplete: boolean;
  stars: StarData[];
}

interface ConstellationSettings {
  activeConstellationId: string | null;
  backgroundConstellationId: string | null;
}

async function fetchSettings(): Promise<ConstellationSettings> {
  const res = await fetch("/api/constellation-settings", { credentials: "include" });
  if (!res.ok) return { activeConstellationId: null, backgroundConstellationId: null };
  return res.json();
}

async function fetchConstellation(id: string): Promise<Constellation | null> {
  const res = await fetch(`/api/constellations/${id}`, { credentials: "include" });
  if (!res.ok) return null;
  return res.json();
}

export function ConstellationBackground() {
  const { data: settings } = useQuery({
    queryKey: ["constellation-settings"],
    queryFn: fetchSettings,
    staleTime: 30000,
  });

  const { data: constellation } = useQuery({
    queryKey: ["constellation", settings?.backgroundConstellationId],
    queryFn: () => fetchConstellation(settings?.backgroundConstellationId!),
    enabled: !!settings?.backgroundConstellationId,
    staleTime: 30000,
  });

  if (!constellation || !constellation.stars.length) {
    return null;
  }

  const getStarStyles = (star: StarData) => {
    let size = 3;
    let glowSize = 6;
    let opacity = 0.15;

    if (star.rarity === "BRIGHT") {
      size = 4;
      glowSize = 10;
      opacity = 0.25;
    } else if (star.rarity === "BRILLIANT") {
      size = 6;
      glowSize = 14;
      opacity = 0.35;
    }

    return { size, glowSize, opacity };
  };

  return (
    <div
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden"
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/50" />
      
      {constellation.stars.map((star) => {
        const { size, glowSize, opacity } = getStarStyles(star);

        return (
          <motion.div
            key={star.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: Math.random() * 0.5 }}
            className="absolute"
            style={{
              left: `${star.positionX * 100}%`,
              top: `${star.positionY * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              className="rounded-full animate-pulse"
              style={{
                width: glowSize,
                height: glowSize,
                background: `radial-gradient(circle, rgba(255, 255, 255, ${opacity}) 0%, transparent 70%)`,
                animationDuration: `${3 + Math.random() * 2}s`,
              }}
            />
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: size,
                height: size,
                backgroundColor: `rgba(255, 255, 255, ${opacity + 0.1})`,
              }}
            />
          </motion.div>
        );
      })}
    </div>
  );
}
