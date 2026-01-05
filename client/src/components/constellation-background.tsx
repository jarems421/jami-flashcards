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
  
  // Ensure minimum ray thickness for small stars
  const mainRayThickness = Math.max(1.5, size * 0.06);
  const diagRayThickness = Math.max(1, size * 0.04);
  const coreSize = Math.max(3, size * 0.15);
  const innerShineSize = Math.max(5, size * 0.4);
  
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
          background: `radial-gradient(circle, ${colors.outer} 0%, transparent 70%)`,
          filter: `blur(${Math.max(0.5, size * 0.03)}px)`,
        }}
      />
      
      {/* Main horizontal ray */}
      <div 
        className="absolute top-1/2 left-0 right-0"
        style={{
          height: mainRayThickness,
          transform: 'translateY(-50%)',
          background: `linear-gradient(90deg, transparent 0%, ${colors.glow} 20%, ${colors.core} 50%, ${colors.glow} 80%, transparent 100%)`,
          filter: `blur(${Math.max(0.3, size * 0.02)}px)`,
        }}
      />
      
      {/* Main vertical ray */}
      <div 
        className="absolute left-1/2 top-0 bottom-0"
        style={{
          width: mainRayThickness,
          transform: 'translateX(-50%)',
          background: `linear-gradient(180deg, transparent 0%, ${colors.glow} 20%, ${colors.core} 50%, ${colors.glow} 80%, transparent 100%)`,
          filter: `blur(${Math.max(0.3, size * 0.02)}px)`,
        }}
      />
      
      {/* Diagonal ray 1 (45 deg) */}
      <div 
        className="absolute top-1/2 left-1/2"
        style={{
          width: glowSize * 0.75,
          height: diagRayThickness,
          transform: 'translate(-50%, -50%) rotate(45deg)',
          background: `linear-gradient(90deg, transparent 0%, ${colors.glow} 25%, ${colors.core} 50%, ${colors.glow} 75%, transparent 100%)`,
          filter: `blur(${Math.max(0.2, size * 0.015)}px)`,
        }}
      />
      
      {/* Diagonal ray 2 (135 deg) */}
      <div 
        className="absolute top-1/2 left-1/2"
        style={{
          width: glowSize * 0.75,
          height: diagRayThickness,
          transform: 'translate(-50%, -50%) rotate(-45deg)',
          background: `linear-gradient(90deg, transparent 0%, ${colors.glow} 25%, ${colors.core} 50%, ${colors.glow} 75%, transparent 100%)`,
          filter: `blur(${Math.max(0.2, size * 0.015)}px)`,
        }}
      />
      
      {/* Inner shine */}
      <div 
        className="absolute top-1/2 left-1/2 rounded-full"
        style={{
          width: innerShineSize,
          height: innerShineSize,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, ${colors.core} 0%, ${colors.glow} 50%, transparent 100%)`,
          filter: `blur(${Math.max(0.3, size * 0.025)}px)`,
        }}
      />
      
      {/* Bright core with enhanced shine */}
      <div 
        className="absolute top-1/2 left-1/2 rounded-full"
        style={{
          width: coreSize,
          height: coreSize,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, white 0%, ${colors.core} 60%)`,
          boxShadow: `0 0 ${Math.max(4, size * 0.3)}px ${colors.core}, 0 0 ${Math.max(2, size * 0.15)}px white, 0 0 ${Math.max(6, size * 0.5)}px ${colors.glow}`,
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
