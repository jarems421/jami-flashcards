import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { calculateStarSize, StarRarityType, getStarDisplayName } from "@shared/starSize";

import starNormal from "../assets/star-normal.png";
import starAscended from "../assets/star-ascended.png";
import starTranscendent from "../assets/star-transcendent.png";

const starImages: Record<StarRarityType, string> = {
  NORMAL: starNormal,
  BRIGHT: starAscended,
  BRILLIANT: starTranscendent,
};

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
    const size = calculateStarSize(star.goalTargetCount || 10, star.targetAccuracy || 80) * 0.6;
    
    let opacity = 0.5;
    if (star.rarity === "BRIGHT") {
      opacity = 0.6;
    } else if (star.rarity === "BRILLIANT") {
      opacity = 0.7;
    }

    return { size, opacity };
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
      
      <style>{`
        @keyframes bg-breathing {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; }
        }
        @keyframes bg-slow-rotate {
          0% { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
        @keyframes bg-subtle-pulse {
          0%, 100% { opacity: 0.9; }
          50% { opacity: 1; }
        }
      `}</style>
      
      {constellation.stars.map((star) => {
        const { size, opacity } = getStarStyles(star);
        const glowColor = star.rarity === "BRILLIANT" 
          ? 'rgba(200, 220, 255, 0.08)' 
          : star.rarity === "BRIGHT"
            ? 'rgba(255, 245, 220, 0.06)'
            : 'rgba(255, 255, 255, 0.04)';

        return (
          <motion.div
            key={star.id}
            initial={{ opacity: 0 }}
            animate={{ opacity }}
            transition={{ duration: 1, delay: Math.random() * 0.5 }}
            className="absolute"
            style={{
              left: `${star.positionX * 100}%`,
              top: `${star.positionY * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div className="relative" style={{ width: size * 1.3, height: size * 1.3 }}>
              <div 
                className="absolute inset-0 rounded-full"
                style={{
                  background: `radial-gradient(circle, ${glowColor} 0%, transparent 60%)`,
                  animation: star.rarity === "BRIGHT" 
                    ? 'bg-breathing 4s ease-in-out infinite' 
                    : 'bg-subtle-pulse 5s ease-in-out infinite',
                }}
              />
              <img
                src={starImages[star.rarity]}
                alt={getStarDisplayName(star.rarity)}
                className="absolute top-1/2 left-1/2 object-contain pointer-events-none"
                style={{
                  width: size,
                  height: size,
                  transform: 'translate(-50%, -50%)',
                  filter: `drop-shadow(0 0 ${size * 0.1}px rgba(255, 255, 255, 0.3))`,
                  animation: star.rarity === "BRILLIANT" 
                    ? 'bg-slow-rotate 120s linear infinite' 
                    : star.rarity === "BRIGHT"
                      ? 'bg-breathing 4s ease-in-out infinite'
                      : undefined,
                  transformOrigin: star.rarity === "BRILLIANT" ? undefined : 'center center',
                }}
                draggable={false}
              />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
