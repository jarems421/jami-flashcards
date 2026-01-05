import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { calculateStarSize, StarRarityType } from "@shared/starSize";

const starColors: Record<StarRarityType, { primary: string; glow: string }> = {
  NORMAL: { primary: "#FFFFFF", glow: "rgba(255, 255, 255, 0.6)" },
  BRIGHT: { primary: "#FFF8DC", glow: "rgba(255, 248, 220, 0.7)" },
  BRILLIANT: { primary: "#E8F0FF", glow: "rgba(200, 220, 255, 0.8)" },
};

function StarShape({ rarity, size, id }: { rarity: StarRarityType; size: number; id: string }) {
  const colors = starColors[rarity];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="pointer-events-none"
    >
      <defs>
        <filter id={`bg-glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.8" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <radialGradient id={`bg-starGradient-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={colors.primary} />
          <stop offset="70%" stopColor={colors.primary} stopOpacity="0.9" />
          <stop offset="100%" stopColor={colors.glow} stopOpacity="0.6" />
        </radialGradient>
      </defs>
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill={`url(#bg-starGradient-${id})`}
        filter={`url(#bg-glow-${id})`}
      />
    </svg>
  );
}

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
              style={{
                opacity,
                animation: star.rarity === "BRILLIANT" 
                  ? 'bg-slow-rotate 120s linear infinite' 
                  : star.rarity === "BRIGHT"
                    ? 'bg-breathing 4s ease-in-out infinite'
                    : 'bg-subtle-pulse 5s ease-in-out infinite',
              }}
            >
              <StarShape rarity={star.rarity} size={size} id={star.id} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
