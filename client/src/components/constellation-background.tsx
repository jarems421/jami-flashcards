import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { calculateStarSize, StarRarityType } from "@shared/starSize";

const starColors: Record<StarRarityType, { core: string; glow: string; outer: string }> = {
  NORMAL: { 
    core: "rgba(255, 255, 255, 1)", 
    glow: "rgba(255, 255, 255, 0.7)", 
    outer: "rgba(200, 210, 255, 0.4)" 
  },
  BRIGHT: { 
    core: "rgba(255, 250, 230, 1)", 
    glow: "rgba(255, 235, 180, 0.8)", 
    outer: "rgba(255, 220, 150, 0.5)" 
  },
  BRILLIANT: { 
    core: "rgba(220, 235, 255, 1)", 
    glow: "rgba(180, 210, 255, 0.9)", 
    outer: "rgba(150, 190, 255, 0.6)" 
  },
};

function CSStar({ size, rarity }: { size: number; rarity: StarRarityType }) {
  const colors = starColors[rarity];
  const glowSize = size * 2;
  
  const getAnimation = () => {
    if (rarity === "BRILLIANT") return "bg-slow-rotate 120s linear infinite";
    if (rarity === "BRIGHT") return "bg-breathing 4s ease-in-out infinite";
    return "bg-subtle-pulse 5s ease-in-out infinite";
  };
  
  return (
    <div 
      className="relative" 
      style={{ 
        width: glowSize, 
        height: glowSize,
        animation: getAnimation(),
      }}
    >
      {/* Outer glow */}
      <div 
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${colors.outer} 0%, transparent 60%)`,
          filter: `blur(${size * 0.05}px)`,
        }}
      />
      
      {/* Main horizontal ray */}
      <div 
        className="absolute top-1/2 left-0 right-0"
        style={{
          height: size * 0.1,
          transform: 'translateY(-50%)',
          background: `linear-gradient(90deg, transparent 0%, ${colors.glow} 30%, ${colors.core} 50%, ${colors.glow} 70%, transparent 100%)`,
          filter: `blur(${size * 0.03}px)`,
        }}
      />
      
      {/* Main vertical ray */}
      <div 
        className="absolute left-1/2 top-0 bottom-0"
        style={{
          width: size * 0.1,
          transform: 'translateX(-50%)',
          background: `linear-gradient(180deg, transparent 0%, ${colors.glow} 30%, ${colors.core} 50%, ${colors.glow} 70%, transparent 100%)`,
          filter: `blur(${size * 0.03}px)`,
        }}
      />
      
      {/* Diagonal ray 1 (45 deg) */}
      <div 
        className="absolute top-1/2 left-1/2"
        style={{
          width: glowSize * 0.85,
          height: size * 0.06,
          transform: 'translate(-50%, -50%) rotate(45deg)',
          background: `linear-gradient(90deg, transparent 0%, ${colors.glow} 35%, ${colors.core} 50%, ${colors.glow} 65%, transparent 100%)`,
          filter: `blur(${size * 0.02}px)`,
        }}
      />
      
      {/* Diagonal ray 2 (135 deg) */}
      <div 
        className="absolute top-1/2 left-1/2"
        style={{
          width: glowSize * 0.85,
          height: size * 0.06,
          transform: 'translate(-50%, -50%) rotate(-45deg)',
          background: `linear-gradient(90deg, transparent 0%, ${colors.glow} 35%, ${colors.core} 50%, ${colors.glow} 65%, transparent 100%)`,
          filter: `blur(${size * 0.02}px)`,
        }}
      />
      
      {/* Inner glow */}
      <div 
        className="absolute top-1/2 left-1/2 rounded-full"
        style={{
          width: size * 0.6,
          height: size * 0.6,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, ${colors.core} 0%, ${colors.glow} 40%, transparent 100%)`,
          filter: `blur(${size * 0.04}px)`,
        }}
      />
      
      {/* Bright core */}
      <div 
        className="absolute top-1/2 left-1/2 rounded-full"
        style={{
          width: size * 0.2,
          height: size * 0.2,
          transform: 'translate(-50%, -50%)',
          background: colors.core,
          boxShadow: `0 0 ${size * 0.4}px ${colors.core}, 0 0 ${size * 0.2}px ${colors.core}`,
        }}
      />
    </div>
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
            <div style={{ opacity }}>
              <CSStar rarity={star.rarity} size={size} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
