import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { calculateStarSize, StarRarityType } from "@shared/starSize";

interface StarData {
  id: string;
  orderIndex: number;
  positionX: number;
  positionY: number;
  rarity: StarRarityType;
  goalTargetCount?: number;
  targetAccuracy?: number;
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
  const [location] = useLocation();

  // Don't show constellation background on the constellations page to avoid confusion
  if (location === "/constellations" || location.startsWith("/constellations")) {
    return null;
  }

  if (!isActive || !constellation) {
    return null;
  }

  const getStarStyles = (star: StarData) => {
    const baseSize = calculateStarSize(star.goalTargetCount || 10, star.targetAccuracy || 80);
    
    let opacity = 0.6;
    let color = "rgba(255, 255, 255, 1)";

    if (star.rarity === "BRIGHT") {
      opacity = 0.75;
      color = "rgba(251, 191, 36, 1)";
    } else if (star.rarity === "BRILLIANT") {
      opacity = 0.9;
      color = "rgba(96, 165, 250, 1)";
    }

    const size = baseSize;
    const glowSize = size * 1.5;

    return { size, glowSize, opacity, color };
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
        const { size, glowSize, opacity, color } = getStarStyles(star);
        const glowColor = color.replace('1)', `${opacity})`);

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
                  background: `radial-gradient(circle, ${glowColor.replace(`${opacity})`, `${opacity * 0.4})`)} 0%, transparent 60%)`,
                  animationDuration: `${3 + Math.random() * 2}s`,
                }}
              />
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{
                  width: size,
                  height: size,
                  filter: `blur(${Math.max(0.5, size * 0.02)}px)`,
                }}
              >
                <div
                  className="absolute top-1/2 left-0 -translate-y-1/2"
                  style={{
                    width: '100%',
                    height: Math.max(2, size * 0.08),
                    background: `linear-gradient(90deg, transparent 0%, ${glowColor.replace(`${opacity})`, '0.3)')} 25%, ${glowColor.replace(`${opacity})`, '0.8)')} 45%, ${color} 50%, ${glowColor.replace(`${opacity})`, '0.8)')} 55%, ${glowColor.replace(`${opacity})`, '0.3)')} 75%, transparent 100%)`,
                    borderRadius: '50%',
                  }}
                />
                <div
                  className="absolute left-1/2 top-0 -translate-x-1/2"
                  style={{
                    height: '100%',
                    width: Math.max(2, size * 0.08),
                    background: `linear-gradient(180deg, transparent 0%, ${glowColor.replace(`${opacity})`, '0.3)')} 25%, ${glowColor.replace(`${opacity})`, '0.8)')} 45%, ${color} 50%, ${glowColor.replace(`${opacity})`, '0.8)')} 55%, ${glowColor.replace(`${opacity})`, '0.3)')} 75%, transparent 100%)`,
                    borderRadius: '50%',
                  }}
                />
                <div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    width: size * 0.25,
                    height: size * 0.25,
                    background: `radial-gradient(circle, ${color} 0%, ${glowColor.replace(`${opacity})`, '0.8)')} 40%, transparent 100%)`,
                    boxShadow: `0 0 ${size * 0.2}px ${color}, 0 0 ${size * 0.4}px ${glowColor.replace(`${opacity})`, '0.5)')}`,
                  }}
                />
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
