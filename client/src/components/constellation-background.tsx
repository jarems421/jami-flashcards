import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { calculateStarSize } from "@shared/starSize";
import glitterStar from "@assets/—Pngtree—vector_white_glitter_stars_element_5449106_1767310369044.png";

interface StarData {
  id: string;
  orderIndex: number;
  positionX: number;
  positionY: number;
  rarity: "NORMAL" | "BRIGHT" | "BRILLIANT";
  goalTargetCount?: number;
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

export function useConstellationBackground() {
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

  const isActive = !!constellation && constellation.stars.length > 0;
  
  return { isActive, constellation };
}

export function ConstellationBackground() {
  const { isActive, constellation } = useConstellationBackground();

  if (!isActive || !constellation) {
    return null;
  }

  const getStarStyles = (star: StarData) => {
    const baseSize = calculateStarSize(star.goalTargetCount || 10, { 
      baseStarSize: 16,
      minSize: 8, 
      maxSize: 40 
    });
    
    let sizeMultiplier = 1;
    let opacity = 0.6;

    if (star.rarity === "BRIGHT") {
      sizeMultiplier = 1.25;
      opacity = 0.75;
    } else if (star.rarity === "BRILLIANT") {
      sizeMultiplier = 1.5;
      opacity = 0.9;
    }

    const size = baseSize * sizeMultiplier;
    const glowSize = size * 1.5;

    return { size, glowSize, opacity };
  };

  return (
    <div
      className="fixed inset-0 pointer-events-none z-0 overflow-hidden bg-gradient-to-b from-slate-900 via-slate-950 to-black"
      aria-hidden="true"
    >
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(99, 102, 241, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.1) 0%, transparent 50%)",
        }}
      />
      
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
              className="relative"
              style={{
                width: glowSize,
                height: glowSize,
              }}
            >
              <div
                className="absolute inset-0 animate-pulse"
                style={{
                  background: `radial-gradient(circle, rgba(255, 255, 255, ${opacity}) 0%, transparent 70%)`,
                  animationDuration: `${3 + Math.random() * 2}s`,
                }}
              />
              <img
                src={glitterStar}
                alt=""
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{
                  width: size,
                  height: size,
                  filter: `drop-shadow(0 0 ${size * 0.3}px rgba(255, 255, 255, ${opacity}))`,
                  opacity: opacity + 0.1,
                }}
              />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
