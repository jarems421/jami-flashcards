"use client";

import {
  clampPercentage,
  getEffectiveStarVisualSize,
  type NormalizedStar,
} from "@/lib/constellation/stars";
import { NORTHERN_STAR_BOX, NORTHERN_STAR_PATH } from "@/components/ui/NorthernStar";

type ConstellationStarProps = {
  star: NormalizedStar;
  onDragStart?: () => void;
  onNudge?: (position: NormalizedStar["position"]) => void;
  variant?: "default" | "background" | "preview";
  label?: string;
};

/**
 * The earned star, as a mask for the glow behind it.
 *
 * This masked a 202KB PNG, so the star a student earned in the reward overlay
 * and the star they then found in their sky were two different drawings. The
 * overlay, the walkthrough trail and the signed-out landing page all use
 * NorthernStar, and its own docstring says the point is that they "read as one
 * object at three sizes" -- the sky, which is the whole feature, was the one
 * surface that never joined.
 *
 * Masking rather than drawing keeps everything that was already right: the
 * radial gradient carries the colour, the filter carries the glow, and the
 * blend mode still lifts it off the night sky. Only the silhouette changes.
 */
const NORTHERN_STAR_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${NORTHERN_STAR_BOX} ${NORTHERN_STAR_BOX}"><path d="${NORTHERN_STAR_PATH}" fill="#000"/></svg>`
)}")`;

function getTwinkleDuration(star: NormalizedStar, isBackground: boolean) {
  const base = isBackground ? 3.2 : 2.8;
  const variation = (star.createdAt % 4) / 10 + ((star.id.length % 7) / 10);

  return `${base + variation}s`;
}

/**
 * The halo's cycle, deliberately out of step with the star's.
 *
 * Roughly twice the twinkle and seeded differently, so the light swelling and
 * the star brightening never land together. Two things breathing on one beat
 * reads as a pulse; on two it reads as air.
 */
function getRadianceDuration(star: NormalizedStar) {
  return `${6.4 + (star.createdAt % 5) / 2 + (star.id.length % 4) / 3}s`;
}

function getTwinkleDelay(star: NormalizedStar) {
  const delay = (star.createdAt % 9) / 10;
  return `${delay}s`;
}

/**
 * How far the halo reaches past the star, as a multiple of its width.
 *
 * Wide enough to read as light rather than as an outline, narrow enough that
 * forty of them in one sky stay separate objects instead of a haze.
 */
const HALO_SIZE_RATIO = 2.6;

function getStarPalette(color: string) {
  if (color === "gold") {
    return {
      core: "rgba(255, 252, 220, 1)",
      middle: "rgba(255, 214, 102, 0.92)",
      edge: "rgba(255, 173, 51, 0)",
      glow: "rgba(255, 199, 82, 0.3)",
      halo: "255, 199, 82",
    };
  }

  if (color === "blue") {
    return {
      core: "rgba(241, 251, 255, 1)",
      middle: "rgba(126, 200, 255, 0.92)",
      edge: "rgba(72, 124, 255, 0)",
      glow: "rgba(100, 160, 255, 0.3)",
      halo: "100, 160, 255",
    };
  }

  return {
    core: "rgba(255, 255, 255, 1)",
    middle: "rgba(240, 232, 255, 0.92)",
    edge: "rgba(214, 189, 255, 0)",
    glow: "rgba(203, 167, 255, 0.18)",
    halo: "203, 167, 255",
  };
}

/**
 * The light a star throws, in proportion to the star.
 *
 * These radii were starSize / 52 against constants near 1: about 3% and 7% of
 * the star, which is a hairline at every size rather than only at small ones.
 * Side by side against the old values the star was crisp and sitting on
 * nothing. The radii are fractions of the star now, and the outer shadow takes
 * the star's own hue, so a gold star throws gold light rather than violet.
 *
 * The numbers came out of a four-level comparison rendered at 18, 26, 34 and
 * 52px. Roughly double these and the halo starts to swallow the star at the
 * top of the size range, which is the whole thing this is meant to light.
 */
function getStarGlowFilter(
  glowStrength: number,
  isBackground: boolean,
  starSize: number,
  halo: string
) {
  if (isBackground) {
    // Sixty of these can be on screen at once, so it stays a single shadow.
    const glow = starSize * (0.10 + glowStrength * 0.08);
    return `drop-shadow(0 0 ${glow}px rgba(255, 255, 255, 0.34))`;
  }

  const innerGlow = starSize * (0.06 + glowStrength * 0.06);
  const outerGlow = starSize * (0.16 + glowStrength * 0.18);

  return [
    `drop-shadow(0 0 ${innerGlow}px rgba(255, 255, 255, 0.75))`,
    `drop-shadow(0 0 ${outerGlow}px rgba(${halo}, 0.32))`,
  ].join(" ");
}

export default function ConstellationStar({
  star,
  onDragStart,
  onNudge,
  variant = "default",
  label = "Earned star",
}: ConstellationStarProps) {
  const isBackground = variant === "background";
  const isPreview = variant === "preview";
  const glowStrength = Math.max(0, Math.min(1, star.glow));
  const haloAlpha = 0.08 + glowStrength * 0.09;
  // Was multiplied by a three-branch ternary whose every branch was 1.
  const starSize = getEffectiveStarVisualSize(star);
  const palette = getStarPalette(star.color);
  const className = `absolute select-none ${variant === "default" ? "constellation-star-enter" : ""} ${onDragStart ? "cursor-grab touch-none" : ""}`;
  const style = {
    left: `${star.position.x}%`,
    top: `${star.position.y}%`,
    transform: "translate(-50%, -50%)",
    width: `${starSize}px`,
    height: `${starSize}px`,
  };
  const visual = (
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
      {/*
        * The radiance, drawn behind the star and unmasked.
        *
        * The star itself is a gradient cut to the star's own outline, so the
        * light stops exactly where the shape does and a drop-shadow is all
        * that escapes it. This is the halo: a soft circle a good deal wider
        * than the star, on its own slower cycle, so the glow breathes rather
        * than blinking in step with the twinkle.
        *
        * Left off the background variant, where sixty of them would be a
        * sixty-layer composite for something nobody is looking at.
        */}
      {isBackground ? null : (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2"
          aria-hidden="true"
          style={{
            width: `${starSize * HALO_SIZE_RATIO}px`,
            height: `${starSize * HALO_SIZE_RATIO}px`,
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle at center, rgba(${palette.halo}, ${haloAlpha}) 0%, rgba(${palette.halo}, ${haloAlpha * 0.44}) 34%, rgba(${palette.halo}, 0) 70%)`,
            mixBlendMode: "screen",
            animationName: "constellation-radiance",
            animationDuration: getRadianceDuration(star),
            animationDelay: getTwinkleDelay(star),
            animationIterationCount: "infinite",
            animationTimingFunction: "ease-in-out",
            willChange: "opacity, transform",
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          background: isBackground
            ? `radial-gradient(circle at center, ${palette.core} 0%, ${palette.middle} 18%, ${palette.glow} 42%, ${palette.edge} 68%)`
            : `radial-gradient(circle at center, ${palette.core} 0%, ${palette.middle} 24%, ${palette.glow} 54%, ${palette.edge} 78%)`,
          opacity: isBackground ? 0.88 : isPreview ? 0.92 : 0.84,
          filter: `${getStarGlowFilter(glowStrength, isBackground, starSize, palette.halo)} brightness(1.02)`,
          mixBlendMode: "screen",
          WebkitMaskImage: NORTHERN_STAR_MASK,
          maskImage: NORTHERN_STAR_MASK,
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
  );

  if (onDragStart || onNudge) {
    return (
      <button
        type="button"
        aria-label={`${label}. Use the arrow keys to move this star.`}
        onPointerDown={onDragStart}
        onKeyDown={(event) => {
          if (!onNudge) return;
          const step = event.shiftKey ? 5 : 1;
          const offset = {
            ArrowLeft: { x: -step, y: 0 },
            ArrowRight: { x: step, y: 0 },
            ArrowUp: { x: 0, y: -step },
            ArrowDown: { x: 0, y: step },
          }[event.key];
          if (!offset) return;
          event.preventDefault();
          onNudge({
            x: clampPercentage(star.position.x + offset.x),
            y: clampPercentage(star.position.y + offset.y),
          });
        }}
        className={`${className} border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-selected-border)]`}
        style={style}
        title={label}
      >
        {visual}
      </button>
    );
  }

  return (
    <div
      className={className}
      style={style}
      title={label}
    >
      {visual}
    </div>
  );
}
