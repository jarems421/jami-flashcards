import { useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { calculateStarSize } from "@shared/starSize";

interface Star {
  id: string;
  orderIndex: number;
  positionX: number;
  positionY: number;
  rarity: "NORMAL" | "BRIGHT" | "BRILLIANT";
  earnedAt: string;
  goalTargetCount?: number;
}

interface StarCanvasProps {
  stars: Star[];
  editable?: boolean;
  onStarMove?: (starId: string, positionX: number, positionY: number) => void;
  showLabels?: boolean;
  className?: string;
  newStarId?: string | null;
}

export function StarCanvas({
  stars,
  editable = false,
  onStarMove,
  showLabels = false,
  className = "",
  newStarId = null,
}: StarCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [draggingStar, setDraggingStar] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, starId: string) => {
      if (!editable) return;
      e.preventDefault();
      setDraggingStar(starId);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const star = stars.find((s) => s.id === starId);
        if (star) {
          const starX = star.positionX * rect.width;
          const starY = star.positionY * rect.height;
          setDragOffset({
            x: e.clientX - rect.left - starX,
            y: e.clientY - rect.top - starY,
          });
        }
      }
    },
    [editable, stars]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent, starId: string) => {
      if (!editable) return;
      const touch = e.touches[0];
      setDraggingStar(starId);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const star = stars.find((s) => s.id === starId);
        if (star) {
          const starX = star.positionX * rect.width;
          const starY = star.positionY * rect.height;
          setDragOffset({
            x: touch.clientX - rect.left - starX,
            y: touch.clientY - rect.top - starY,
          });
        }
      }
    },
    [editable, stars]
  );

  useEffect(() => {
    if (!draggingStar) return;

    const handleMove = (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      let newX = (clientX - rect.left - dragOffset.x) / rect.width;
      let newY = (clientY - rect.top - dragOffset.y) / rect.height;

      newX = Math.max(0.05, Math.min(0.95, newX));
      newY = Math.max(0.05, Math.min(0.95, newY));

      onStarMove?.(draggingStar, newX, newY);
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    };

    const handleEnd = () => {
      setDraggingStar(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleEnd);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [draggingStar, dragOffset, onStarMove]);

  const getStarStyles = (star: Star) => {
    const baseSize = calculateStarSize(star.goalTargetCount || 10);
    
    let sizeMultiplier = 1;
    let glowOpacity = 0.4;

    if (star.rarity === "BRIGHT") {
      sizeMultiplier = 1.25;
      glowOpacity = 0.6;
    } else if (star.rarity === "BRILLIANT") {
      sizeMultiplier = 1.5;
      glowOpacity = 0.8;
    }

    const size = baseSize * sizeMultiplier;
    const glowSize = size * 1.5;

    return { size, glowSize, glowOpacity };
  };

  return (
    <div
      ref={canvasRef}
      className={`relative bg-gradient-to-b from-slate-900 via-slate-950 to-black rounded-xl overflow-hidden ${className}`}
      style={{ touchAction: editable ? "none" : "auto" }}
      data-testid="star-canvas"
    >
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(99, 102, 241, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.1) 0%, transparent 50%)",
        }}
      />

      <AnimatePresence>
        {stars.map((star) => {
          const { size, glowSize, glowOpacity } = getStarStyles(star);
          const isNew = star.id === newStarId;
          const isDragging = star.id === draggingStar;

          return (
            <motion.div
              key={star.id}
              initial={isNew ? { scale: 0, opacity: 0 } : false}
              animate={{
                scale: 1,
                opacity: 1,
                left: `${star.positionX * 100}%`,
                top: `${star.positionY * 100}%`,
              }}
              transition={
                isNew
                  ? { type: "spring", duration: 0.8, bounce: 0.4 }
                  : { type: "spring", stiffness: 300, damping: 30 }
              }
              className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                editable ? "cursor-grab" : ""
              } ${isDragging ? "cursor-grabbing z-50" : ""}`}
              style={{ touchAction: "none" }}
              onMouseDown={(e) => handleMouseDown(e, star.id)}
              onTouchStart={(e) => handleTouchStart(e, star.id)}
              data-testid={`star-${star.orderIndex}`}
            >
              <div
                className="relative"
                style={{
                  width: glowSize,
                  height: glowSize,
                }}
              >
                {/* Soft glow background */}
                <div 
                  className="absolute inset-0 animate-pulse"
                  style={{
                    background: `radial-gradient(circle, rgba(255, 255, 255, ${glowOpacity * 0.5}) 0%, transparent 60%)`,
                    animationDuration: '3s',
                  }}
                />
                {/* CSS four-pointed star */}
                <div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{
                    width: size,
                    height: size,
                  }}
                >
                  {/* Horizontal ray */}
                  <div
                    className="absolute top-1/2 left-0 -translate-y-1/2"
                    style={{
                      width: '100%',
                      height: size * 0.08,
                      background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,${glowOpacity}) 40%, white 50%, rgba(255,255,255,${glowOpacity}) 60%, transparent 100%)`,
                    }}
                  />
                  {/* Vertical ray */}
                  <div
                    className="absolute left-1/2 top-0 -translate-x-1/2"
                    style={{
                      height: '100%',
                      width: size * 0.08,
                      background: `linear-gradient(180deg, transparent 0%, rgba(255,255,255,${glowOpacity}) 40%, white 50%, rgba(255,255,255,${glowOpacity}) 60%, transparent 100%)`,
                    }}
                  />
                  {/* Bright center core */}
                  <div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      width: size * 0.25,
                      height: size * 0.25,
                      background: 'white',
                      boxShadow: `0 0 ${size * 0.2}px white, 0 0 ${size * 0.4}px rgba(255,255,255,0.5)`,
                    }}
                  />
                </div>
              </div>
              {showLabels && (
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1 text-[10px] text-white/60">
                  {star.orderIndex}
                </span>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      <div className="absolute bottom-3 right-3 text-white/40 text-sm font-medium">
        {stars.length} / 100
      </div>
    </div>
  );
}

export function ConstellationCompletionAnimation({
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
                  "0 0 20px rgba(255, 239, 180, 0.3)",
                  "0 0 60px rgba(255, 239, 180, 0.6)",
                  "0 0 20px rgba(255, 239, 180, 0.3)",
                ],
              }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-amber-200 to-amber-400 flex items-center justify-center"
            >
              <svg
                className="w-12 h-12 text-amber-900"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </motion.div>
            <h2 className="text-2xl font-light text-white mb-2">
              Constellation Complete
            </h2>
            <p className="text-white/60 text-sm">
              A new chapter begins...
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
