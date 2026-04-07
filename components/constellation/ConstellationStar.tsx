"use client";

import {
  getEffectiveStarPresetId,
  getEffectiveStarVisualSize,
  getStarPresetIconPath,
  type NormalizedStar,
} from "@/lib/constellation/stars";

type ConstellationStarProps = {
  star: NormalizedStar;
  onDragStart?: () => void;
  variant?: "default" | "background" | "preview";
};

const DEFAULT_STAR_ICON = "/images/constellation/star.png";

function getTwinkleDuration(star: NormalizedStar, isBackground: boolean) {
  const base = isBackground ? 3.2 : 2.8;
  const variation = (star.createdAt % 4) / 10 + ((star.id.length % 7) / 10);

  return `${base + variation}s`;
}

function getTwinkleDelay(star: NormalizedStar) {
  const delay = (star.createdAt % 9) / 10;
  return `${delay}s`;
}

const GLOW_REFERENCE_SIZE = 52;

function getStarGlowFilter(glowStrength: number, isBackground: boolean, starSize: number) {
  const scale = starSize / GLOW_REFERENCE_SIZE;

  if (isBackground) {
    const glow = (glowStrength * 0.4 + 0.2) * scale;
    return `drop-shadow(0 0 ${glow}px rgba(255, 255, 255, 0.38))`;
  }

  const innerGlow = (glowStrength * 1.1 + 0.7) * scale;
  const outerGlow = (glowStrength * 2.4 + 1.2) * scale;

  return [
    `drop-shadow(0 0 ${innerGlow}px rgba(255, 255, 255, 0.72))`,
    `drop-shadow(0 0 ${outerGlow}px rgba(203, 167, 255, 0.18))`,
  ].join(" ");
}

export default function ConstellationStar({
  star,
  onDragStart,
  variant = "default",
}: ConstellationStarProps) {
  const isBackground = variant === "background";
  const isPreview = variant === "preview";
  const glowStrength = Math.max(0, Math.min(1, star.glow));
  const starSize =
    getEffectiveStarVisualSize(star) *
    (isBackground ? 1.0 : isPreview ? 1.0 : 1);
  const effectivePresetId = getEffectiveStarPresetId(star);
  const presetIcon = getStarPresetIconPath(effectivePresetId) ?? DEFAULT_STAR_ICON;

  return (
    <div
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      className={`absolute select-none ${onDragStart ? "cursor-grab touch-none" : ""}`}
      style={{
        left: `${star.position.x}%`,
        top: `${star.position.y}%`,
        transform: "translate(-50%, -50%)",
        width: `${starSize}px`,
        height: `${starSize}px`,
      }}
    >
      <div
        className="pointer-events-none relative h-full w-full"
        style={{
          animationName: "constellation-twinkle",
          animationDuration: getTwinkleDuration(star, isBackground),
          animationDelay: getTwinkleDelay(star),
          animationIterationCount: "infinite",
          animationTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
          transformOrigin: "center",
          willChange: "transform, opacity",
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: isBackground
              ? "radial-gradient(circle at center, rgba(255, 255, 255, 1) 0%, rgba(240, 232, 255, 0.92) 18%, rgba(220, 200, 255, 0.5) 42%, rgba(214, 189, 255, 0) 68%)"
              : "radial-gradient(circle at center, rgba(255, 255, 255, 0.96) 0%, rgba(236, 226, 255, 0.82) 24%, rgba(214, 189, 255, 0.34) 54%, rgba(214, 189, 255, 0) 78%)",
            opacity: isBackground ? 0.88 : isPreview ? 0.92 : 0.84,
            filter: `${getStarGlowFilter(glowStrength, isBackground, starSize)} brightness(1.02)`,
            mixBlendMode: "screen",
            WebkitMaskImage: `url("${presetIcon}")`,
            maskImage: `url("${presetIcon}")`,
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
            maskMode: "alpha",
            willChange: "transform, opacity",
          }}
        />
      </div>
    </div>
  );
}

