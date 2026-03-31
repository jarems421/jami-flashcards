"use client";

import Image from "next/image";
import {
  getEffectiveStarPresetId,
  getEffectiveStarVisualSize,
  getStarPresetIconPath,
  type NormalizedStar,
} from "@/lib/stars";

type ConstellationStarProps = {
  star: NormalizedStar;
  onDragStart?: () => void;
  variant?: "default" | "background";
};

function getStarDisplayColor(color: string) {
  if (color === "gold") {
    return "#f5d76e";
  }

  if (color === "blue") {
    return "#8ec5ff";
  }

  return "#ffffff";
}

function getTwinkleDuration(star: NormalizedStar) {
  const base = 2;
  const variation = (star.createdAt % 3) + ((star.id.length % 10) / 10);
  return `${base + variation}s`;
}

function getTwinkleDelay(star: NormalizedStar) {
  const delay = (star.createdAt % 5) / 10;
  return `${delay}s`;
}

function getStarIconFilter(color: string) {
  if (color === "gold") {
    return "invert(1) sepia(1) saturate(6000%) hue-rotate(10deg) brightness(1.2)";
  }

  if (color === "blue") {
    return "invert(1) sepia(1) saturate(4000%) hue-rotate(190deg) brightness(1.15)";
  }

  return "invert(1) brightness(1.2)";
}

export default function ConstellationStar({
  star,
  onDragStart,
  variant = "default",
}: ConstellationStarProps) {
  const isBackground = variant === "background";
  const displayColor = getStarDisplayColor(star.color);
  const glowStrength = Math.max(0, Math.min(1, star.glow));
  const svgSize = getEffectiveStarVisualSize(star) * (isBackground ? 0.68 : 1);
  const center = svgSize / 2;
  const haloRadius = svgSize * 0.16;
  const coreRadius = Math.max(2.5, svgSize * 0.05);
  const centerFillColor = "#ffffff";
  const horizontalRayWidth = svgSize * 0.2;
  const verticalRayHeight = svgSize * 0.9;
  const primaryRayThickness = Math.max(0.3, svgSize * 0.008);
  const innerRayThickness = Math.max(0.1, svgSize * 0.002);
  const glowBlur = Math.max(1.6, svgSize * 0.016);
  const rayBlur = Math.max(0.55, svgSize * 0.006);
  const sparkleLength = Math.max(2.6, svgSize * 0.08);
  const sparkleStroke = Math.max(0.16, svgSize * 0.002);
  const haloOpacity = 0.12 + glowStrength * 0.88;
  const auraOpacity = 0.08 + glowStrength * 0.74;
  const primaryRayOpacity = 0.18 + glowStrength * 0.82;
  const innerRayOpacity = 0.16 + glowStrength * 0.84;
  const sparkleOpacity = 0.05 + glowStrength * 0.32;
  const safeId = star.id.replace(/[^a-zA-Z0-9_-]/g, "") || "star";
  const effectivePresetId = getEffectiveStarPresetId(star);
  const presetIcon = getStarPresetIconPath(effectivePresetId);
  const iconFilter = getStarIconFilter(star.color);

  const auraRadius = svgSize * 0.055;
  const backgroundCoreRadius = Math.max(1.6, svgSize * 0.09);
  const backgroundRayLength = Math.max(4.5, svgSize * 0.42);
  const backgroundRayThickness = Math.max(0.5, svgSize * 0.02);
  const backgroundHaloRadius = Math.max(3.6, svgSize * 0.2);

  if (presetIcon) {
    return (
      <div
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        className={`absolute select-none ${onDragStart ? "cursor-grab touch-none" : ""}`}
        style={{
          left: `${star.position.x}%`,
          top: `${star.position.y}%`,
          transform: "translate(-50%, -50%)",
          width: `${svgSize}px`,
          height: `${svgSize}px`,
        }}
      >
        <div
          className="pointer-events-none relative h-full w-full"
          style={{
            animationName: "constellation-twinkle",
            animationDuration: getTwinkleDuration(star),
            animationDelay: getTwinkleDelay(star),
            animationIterationCount: "infinite",
            animationTimingFunction: "ease-in-out",
            transformOrigin: "center",
          }}
        >
          <Image
            src={presetIcon}
            alt=""
            width={Math.max(1, Math.round(svgSize))}
            height={Math.max(1, Math.round(svgSize))}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              opacity: isBackground ? 0.82 : 1,
              filter: `${iconFilter} drop-shadow(0 0 ${
                isBackground ? glowStrength * 3 + 2 : glowStrength * 6 + 4
              }px ${displayColor})`,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
      className={`absolute select-none ${onDragStart ? "cursor-grab touch-none" : ""}`}
      style={{
        left: `${star.position.x}%`,
        top: `${star.position.y}%`,
        transform: "translate(-50%, -50%)",
        width: `${svgSize}px`,
        height: `${svgSize}px`,
      }}
    >
      <div
        className="pointer-events-none relative h-full w-full"
        style={{
          animationName: "constellation-twinkle",
          animationDuration: getTwinkleDuration(star),
          animationDelay: getTwinkleDelay(star),
          animationIterationCount: "infinite",
          animationTimingFunction: "ease-in-out",
          transformOrigin: "center",
        }}
      >
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          className="overflow-visible"
          shapeRendering="geometricPrecision"
        >
          <defs>
            <filter
              id={`star-glow-${safeId}`}
              x="-150%"
              y="-150%"
              width="400%"
              height="400%"
            >
              <feGaussianBlur stdDeviation={glowBlur} />
            </filter>
            <filter
              id={`star-ray-glow-${safeId}`}
              x="-150%"
              y="-150%"
              width="400%"
              height="400%"
            >
              <feGaussianBlur stdDeviation={rayBlur} />
            </filter>
            <radialGradient id={`star-halo-${safeId}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop
                offset="12%"
                stopColor={displayColor}
                stopOpacity={0.35 + glowStrength * 0.6}
              />
              <stop
                offset="34%"
                stopColor={displayColor}
                stopOpacity={0.08 + glowStrength * 0.4}
              />
              <stop
                offset="68%"
                stopColor={displayColor}
                stopOpacity={0.02 + glowStrength * 0.18}
              />
              <stop offset="100%" stopColor={displayColor} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`star-core-${safeId}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="45%" stopColor="#ffffff" stopOpacity="0.96" />
              <stop
                offset="100%"
                stopColor={displayColor}
                stopOpacity={0.42 + glowStrength * 0.52}
              />
            </radialGradient>
            <linearGradient id={`star-ray-horizontal-${safeId}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={displayColor} stopOpacity="0" />
              <stop offset="18%" stopColor={displayColor} stopOpacity="0.02" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="82%" stopColor={displayColor} stopOpacity="0.02" />
              <stop offset="100%" stopColor={displayColor} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`star-ray-vertical-${safeId}`} x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor={displayColor} stopOpacity="0" />
              <stop offset="18%" stopColor={displayColor} stopOpacity="0.02" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="82%" stopColor={displayColor} stopOpacity="0.02" />
              <stop offset="100%" stopColor={displayColor} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`star-ray-diagonal-${safeId}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={displayColor} stopOpacity="0" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity="0.8" />
              <stop offset="100%" stopColor={displayColor} stopOpacity="0" />
            </linearGradient>
          </defs>

          {isBackground ? (
            <>
              <circle
                cx={center}
                cy={center}
                r={backgroundHaloRadius}
                fill={displayColor}
                opacity={0.08 + glowStrength * 0.12}
              />
              <rect
                x={center - backgroundRayLength / 2}
                y={center - backgroundRayThickness / 2}
                width={backgroundRayLength}
                height={backgroundRayThickness}
                rx={backgroundRayThickness / 2}
                fill="#ffffff"
                opacity={0.18 + glowStrength * 0.2}
              />
              <rect
                x={center - backgroundRayThickness / 2}
                y={center - backgroundRayLength / 2}
                width={backgroundRayThickness}
                height={backgroundRayLength}
                rx={backgroundRayThickness / 2}
                fill="#ffffff"
                opacity={0.18 + glowStrength * 0.2}
              />
              <circle
                cx={center}
                cy={center}
                r={backgroundCoreRadius}
                fill={centerFillColor}
                opacity={0.88}
              />
            </>
          ) : (
            <>

              <circle
                cx={center}
                cy={center}
                r={haloRadius}
                fill={`url(#star-halo-${safeId})`}
                filter={`url(#star-glow-${safeId})`}
                opacity={haloOpacity}
              />

              <circle
                cx={center}
                cy={center}
                r={auraRadius}
                fill={`url(#star-halo-${safeId})`}
                filter={`url(#star-ray-glow-${safeId})`}
                opacity={auraOpacity}
              />

              <rect
                x={center - horizontalRayWidth / 2}
                y={center - primaryRayThickness / 2}
                width={horizontalRayWidth}
                height={primaryRayThickness}
                rx={primaryRayThickness / 2}
                fill={`url(#star-ray-horizontal-${safeId})`}
                filter={`url(#star-ray-glow-${safeId})`}
                opacity={primaryRayOpacity}
              />
              <rect
                x={center - primaryRayThickness / 2}
                y={center - verticalRayHeight / 2}
                width={primaryRayThickness}
                height={verticalRayHeight}
                rx={primaryRayThickness / 2}
                fill={`url(#star-ray-vertical-${safeId})`}
                filter={`url(#star-ray-glow-${safeId})`}
                opacity={primaryRayOpacity}
              />

              <rect
                x={center - horizontalRayWidth / 2}
                y={center - innerRayThickness / 2}
                width={horizontalRayWidth}
                height={innerRayThickness}
                rx={innerRayThickness / 2}
                fill={`url(#star-ray-horizontal-${safeId})`}
                opacity={innerRayOpacity}
              />
              <rect
                x={center - innerRayThickness / 2}
                y={center - verticalRayHeight / 2}
                width={innerRayThickness}
                height={verticalRayHeight}
                rx={innerRayThickness / 2}
                fill={`url(#star-ray-vertical-${safeId})`}
                opacity={innerRayOpacity}
              />

              <line
                x1={center - sparkleLength}
                y1={center - sparkleLength}
                x2={center + sparkleLength}
                y2={center + sparkleLength}
                stroke={`url(#star-ray-diagonal-${safeId})`}
                strokeOpacity={sparkleOpacity}
                strokeWidth={sparkleStroke}
                strokeLinecap="round"
                filter={`url(#star-ray-glow-${safeId})`}
              />
              <line
                x1={center + sparkleLength}
                y1={center - sparkleLength}
                x2={center - sparkleLength}
                y2={center + sparkleLength}
                stroke={`url(#star-ray-diagonal-${safeId})`}
                strokeOpacity={sparkleOpacity * 1.25}
                strokeWidth={sparkleStroke}
                strokeLinecap="round"
                filter={`url(#star-ray-glow-${safeId})`}
              />
              <circle
                cx={center}
                cy={center}
                r={coreRadius}
                fill={centerFillColor}
              />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
