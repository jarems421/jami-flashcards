import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { StarRarityType, getStarDisplayName } from "@shared/starSize";

import starNormal from "../assets/star-normal.png";
import starAscended from "../assets/star-ascended.png";
import starTranscendent from "../assets/star-transcendent.png";

const starImages: Record<StarRarityType, string> = {
  NORMAL: starNormal,
  BRIGHT: starAscended,
  BRILLIANT: starTranscendent,
};

interface CelestialEmergenceProps {
  isVisible: boolean;
  starRarity: StarRarityType;
  starNumber?: number;
  onComplete: () => void;
}

interface DustParticle {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
}

export function CelestialEmergence({
  isVisible,
  starRarity,
  starNumber,
  onComplete,
}: CelestialEmergenceProps) {
  const [particles, setParticles] = useState<DustParticle[]>([]);

  const intensityConfig = {
    NORMAL: { particleCount: 12, glowScale: 1, duration: 1.5 },
    BRIGHT: { particleCount: 20, glowScale: 1.3, duration: 1.8 },
    BRILLIANT: { particleCount: 30, glowScale: 1.6, duration: 2.2 },
  };

  const config = intensityConfig[starRarity];
  const displayName = getStarDisplayName(starRarity);
  const titleText = starRarity === "NORMAL" 
    ? "Star earned" 
    : `${displayName} Star earned`;
  const descriptionText = starRarity === "BRILLIANT"
    ? "25 goals completed."
    : starRarity === "BRIGHT"
      ? "10 goals completed."
      : "You completed your goal.";

  useEffect(() => {
    if (isVisible) {
      const newParticles: DustParticle[] = [];
      for (let i = 0; i < config.particleCount; i++) {
        const angle = (Math.PI * 2 * i) / config.particleCount + Math.random() * 0.5;
        const distance = 80 + Math.random() * 120;
        newParticles.push({
          id: i,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          size: 2 + Math.random() * 3,
          delay: Math.random() * 0.3,
          duration: 1.5 + Math.random() * 1,
        });
      }
      setParticles(newParticles);

      const timer = setTimeout(() => {
        onComplete();
      }, config.duration * 1000 + 200);
      
      return () => clearTimeout(timer);
    }
  }, [isVisible, config.particleCount, config.duration, onComplete]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={onComplete}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 bg-black/40"
          />

          <div className="relative">
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: config.glowScale * 2, opacity: [0, 0.6, 0.3] }}
              transition={{ duration: config.duration, ease: "easeOut" }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: 200,
                height: 200,
                background: `radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, rgba(200, 210, 255, 0.1) 40%, transparent 70%)`,
              }}
            />

            {[0, 45, 90, 135].map((angle) => (
              <motion.div
                key={angle}
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: [0, 1, 0.8], opacity: [0, 0.5, 0] }}
                transition={{ duration: config.duration * 0.8, delay: 0.2, ease: "easeOut" }}
                className="absolute top-1/2 left-1/2"
                style={{
                  width: 150 * config.glowScale,
                  height: 2,
                  background: `linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.4) 50%, transparent 100%)`,
                  transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                  transformOrigin: "center center",
                }}
              />
            ))}

            {particles.map((particle) => (
              <motion.div
                key={particle.id}
                initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                animate={{
                  x: particle.x,
                  y: particle.y,
                  opacity: [0, 0.8, 0],
                  scale: [0, 1, 0.5],
                }}
                transition={{
                  duration: particle.duration,
                  delay: particle.delay,
                  ease: "easeOut",
                }}
                className="absolute top-1/2 left-1/2 rounded-full"
                style={{
                  width: particle.size,
                  height: particle.size,
                  background: starRarity === "BRILLIANT"
                    ? `rgba(200, 220, 255, 0.9)`
                    : starRarity === "BRIGHT"
                      ? `rgba(255, 250, 230, 0.9)`
                      : `rgba(255, 255, 255, 0.8)`,
                  boxShadow: `0 0 ${particle.size * 2}px rgba(255, 255, 255, 0.5)`,
                }}
              />
            ))}

            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ 
                type: "spring",
                duration: 0.8,
                bounce: 0.3,
                delay: 0.1,
              }}
              className="relative z-10"
            >
              <img
                src={starImages[starRarity]}
                alt={displayName}
                className="w-24 h-24 object-contain pointer-events-none"
                style={{
                  filter: `drop-shadow(0 0 20px rgba(255, 255, 255, 0.6))`,
                }}
              />
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="absolute bottom-1/3 text-center"
          >
            <h3 className="text-xl font-light text-white mb-1">{titleText}</h3>
            <p className="text-white/60 text-sm">{descriptionText}</p>
            {starNumber && (
              <p className="text-white/40 text-xs mt-2">Star #{starNumber}</p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConstellationCompleteEmergence({
  isVisible,
  onComplete,
}: {
  isVisible: boolean;
  onComplete: () => void;
}) {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(onComplete, 4000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onComplete]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={onComplete}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="text-center"
          >
            <motion.div
              animate={{
                boxShadow: [
                  "0 0 20px rgba(255, 255, 255, 0.2)",
                  "0 0 60px rgba(255, 255, 255, 0.4)",
                  "0 0 20px rgba(255, 255, 255, 0.2)",
                ],
              }}
              transition={{ duration: 3, repeat: Infinity }}
              className="w-32 h-32 mx-auto mb-6 rounded-full bg-gradient-to-br from-white/90 to-white/60 flex items-center justify-center"
            >
              <svg
                className="w-16 h-16 text-slate-900/80"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </motion.div>
            <h2 className="text-2xl font-light text-white mb-2">
              Constellation complete
            </h2>
            <p className="text-white/60 text-sm">
              A new chapter begins
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
