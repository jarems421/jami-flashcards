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
 * The earned star, as a mask for the light behind it.
 *
 * This masked a 202KB PNG, so the star a student earned in the reward overlay
 * and the star they then found in their sky were two different drawings. The
 * overlay, the walkthrough trail and the signed-out landing page all use
 * NorthernStar, and its own docstring says the point is that they "read as one
 * object at three sizes" -- the sky, which is the whole feature, was the one
 * surface that never joined.
 *
 * Masking rather than drawing keeps the gradient carrying the light and the
 * filter carrying the glow. Only the silhouette changes.
 */
const NORTHERN_STAR_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${NORTHERN_STAR_BOX} ${NORTHERN_STAR_BOX}"><path d="${NORTHERN_STAR_PATH}" fill="#000"/></svg>`
)}")`;

const STAR_MASK_STYLE = {
  WebkitMaskImage: NORTHERN_STAR_MASK,
  maskImage: NORTHERN_STAR_MASK,
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
  maskSize: "contain",
  maskMode: "alpha",
} as const;

/**
 * White, and only white.
 *
 * Stars came in white, blue and gold, warming as goals were completed. Drawn,
 * the hue sat at the 24 per cent stop of this gradient, so a gold star was gold
 * through its core rather than white-hot with warm light around it. Real stars
 * are white in the middle and carry their colour in what they throw; these did
 * the opposite, and looked it.
 */
const STAR_GRADIENT =
  "radial-gradient(circle at center, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.95) 26%, rgba(228, 222, 255, 0.44) 56%, rgba(214, 196, 255, 0) 80%)";

const BACKGROUND_STAR_GRADIENT =
  "radial-gradient(circle at center, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.9) 20%, rgba(228, 222, 255, 0.36) 44%, rgba(214, 196, 255, 0) 70%)";

/**
 * The light a star throws.
 *
 * One shadow, sized from the star. There were two, at radii up to a full star
 * width, sitting under a separate circular halo element -- which is what made
 * the glow read as a strict circle around the star rather than as light. A
 * drop-shadow blurs the star's own silhouette and falls off on a Gaussian, so
 * it takes the shape of the star and has no boundary at all.
 */
function getStarGlowRadius(glowStrength: number, starSize: number) {
  return starSize * (0.09 + glowStrength * 0.09);
}

/**
 * Which stars throw sparkles.
 *
 * Sparkles are the one thing here that adds elements rather than removing
 * them, so they are rationed: only stars at least this wide carry them, which
 * in an ordinary sky is a handful rather than all forty. Never on the
 * background variant, where sixty stars sit behind every page in the app.
 */
const SPARKLE_MIN_STAR_SIZE = 30;
const SPARKLES_PER_STAR = 3;

function getSeededFraction(seed: string, index: number) {
  let hash = 0;
  for (let position = 0; position < seed.length; position += 1) {
    hash = (hash * 31 + seed.charCodeAt(position) + index * 977) % 100_000;
  }
  return hash / 100_000;
}

/**
 * Where a star's sparkles sit, and when each one lights.
 *
 * Seeded from the star's own id, so a star throws the same sparkles in the
 * same places every time it is drawn rather than rearranging itself on every
 * render. The cycles are long and staggered, so at any instant most are dark
 * and the star reads as shedding light rather than flashing.
 */
function getSparkles(star: NormalizedStar, starSize: number) {
  return Array.from({ length: SPARKLES_PER_STAR }, (_, index) => {
    const angle = getSeededFraction(star.id, index) * Math.PI * 2;
    const distance = 55 + getSeededFraction(star.id, index + 7) * 35;
    const size = starSize * (0.13 + getSeededFraction(star.id, index + 13) * 0.08);

    return {
      key: `${star.id}-sparkle-${index}`,
      size,
      left: 50 + Math.cos(angle) * distance,
      top: 50 + Math.sin(angle) * distance,
      driftX: Math.cos(angle) * starSize * 0.14,
      driftY: Math.sin(angle) * starSize * 0.14,
      duration: 5.5 + getSeededFraction(star.id, index + 23) * 4,
      delay: getSeededFraction(star.id, index + 31) * 6,
    };
  });
}

function getTwinkleDuration(star: NormalizedStar, isBackground: boolean) {
  const base = isBackground ? 5.6 : 4.8;
  const variation = (star.createdAt % 4) / 10 + ((star.id.length % 7) / 10);

  return `${base + variation}s`;
}

function getTwinkleDelay(star: NormalizedStar) {
  const delay = (star.createdAt % 9) / 10;
  return `${delay}s`;
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
  // Was multiplied by a three-branch ternary whose every branch was 1.
  const starSize = getEffectiveStarVisualSize(star);
  const sparkles =
    variant === "default" && starSize >= SPARKLE_MIN_STAR_SIZE
      ? getSparkles(star, starSize)
      : [];
  const className = `absolute select-none ${variant === "default" ? "constellation-star-enter" : ""} ${onDragStart ? "cursor-grab touch-none" : ""}`;
  const style = {
    left: `${star.position.x}%`,
    top: `${star.position.y}%`,
    transform: "translate(-50%, -50%)",
    width: `${starSize}px`,
    height: `${starSize}px`,
  };
  /*
   * One element for the star, and nothing promoted.
   *
   * This was three stacked elements -- a twinkle wrapper, a circular halo and
   * the body -- of which two carried `mix-blend-mode: screen` and all three
   * carried `will-change`. At forty stars that is roughly 120 GPU layers and 80
   * blend readbacks a frame, and a blended element cannot be composited on its
   * own: its backdrop has to be re-rasterised every frame. It was visibly laggy.
   *
   * Screen against a near-black sky is very close to normal for bright pixels,
   * so dropping the blend mode costs almost nothing to look at, and the twinkle
   * now animates opacity alone, which the compositor handles without help.
   */
  const visual = (
    <>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: isBackground ? BACKGROUND_STAR_GRADIENT : STAR_GRADIENT,
          opacity: isBackground ? 0.88 : isPreview ? 0.92 : 0.86,
          filter: `drop-shadow(0 0 ${getStarGlowRadius(glowStrength, starSize)}px rgba(255, 255, 255, ${0.4 + glowStrength * 0.3}))`,
          animationName: "constellation-twinkle",
          animationDuration: getTwinkleDuration(star, isBackground),
          animationDelay: getTwinkleDelay(star),
          animationIterationCount: "infinite",
          animationTimingFunction: "ease-in-out",
          ...STAR_MASK_STYLE,
        }}
      />
      {sparkles.map((sparkle) => (
        <div
          key={sparkle.key}
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            width: `${sparkle.size}px`,
            height: `${sparkle.size}px`,
            left: `${sparkle.left}%`,
            top: `${sparkle.top}%`,
            marginLeft: `${-sparkle.size / 2}px`,
            marginTop: `${-sparkle.size / 2}px`,
            background: "rgba(255, 255, 255, 0.95)",
            opacity: 0,
            ["--sparkle-drift-x" as string]: `${sparkle.driftX}px`,
            ["--sparkle-drift-y" as string]: `${sparkle.driftY}px`,
            animationName: "constellation-sparkle",
            animationDuration: `${sparkle.duration}s`,
            animationDelay: `${sparkle.delay}s`,
            animationIterationCount: "infinite",
            animationTimingFunction: "ease-in-out",
            ...STAR_MASK_STYLE,
          }}
        />
      ))}
    </>
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
