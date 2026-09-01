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

/**
 * The light a star throws: a tight white core and a wide violet bloom.
 *
 * Both are drop-shadows, so both blur the star's own silhouette and fall off on
 * a Gaussian -- shaped like the star, with no boundary anywhere. That is the
 * distinction that matters here. An earlier pass got a circular div behind each
 * star, which read as a disc; the answer was never less light, it was light
 * that follows the shape.
 *
 * It then went too far the other way and became a hairline, which is why this
 * is back up to a real radius. It is what makes a 0.165-waist star legible at
 * 18px: the star is thin and the light around it is not.
 */
function getStarGlowFilter(glowStrength: number, starSize: number) {
  const core = starSize * (0.12 + glowStrength * 0.08);
  const bloom = starSize * (0.36 + glowStrength * 0.28);

  return [
    `drop-shadow(0 0 ${core}px rgba(255, 255, 255, ${0.6 + glowStrength * 0.25}))`,
    `drop-shadow(0 0 ${bloom}px rgba(214, 200, 255, ${0.34 + glowStrength * 0.2}))`,
  ].join(" ");
}

/**
 * How many sparkles a star throws.
 *
 * Every star gets some. There used to be a 30px floor below which a star threw
 * none at all, which meant roughly a third of an ordinary sky simply sat
 * still -- and since size tracks the goal behind it, the stars that went
 * without were the ones for smaller goals. The floor was there to ration
 * elements when the page was struggling for frames; it is not needed now that
 * the blend modes are gone, and it was solving the problem in the wrong place.
 *
 * Count scales with the star instead, which is also what looks right: four
 * sparkles around an 18px star would crowd it. Small stars get two, on opposite
 * diagonals; larger ones get all four, one per quadrant.
 */
const SPARKLE_FULL_STAR_SIZE = 30;
const SPARKLES_PER_STAR = 4;

function getSparkleCount(starSize: number) {
  return starSize >= SPARKLE_FULL_STAR_SIZE ? SPARKLES_PER_STAR : 2;
}

/**
 * The bloom: light standing off the star, in the star's own proportions.
 *
 * This has now been wrong in both directions and the failures are worth
 * keeping, because they are opposite. A circular div was drawn behind each star
 * and read as "a strict circle around the star" -- its alpha stepped 0.16, 0.07,
 * 0, which leaves a shoulder, and the eye finds a shoulder and calls it an
 * edge. Replacing it with two crossed ellipses along the star's axes went the
 * other way: thin streaks running past the tips read as spikes pointing off the
 * peaks rather than as anything glowing.
 *
 * So: one soft ellipse, no streaks, alpha roughly halving at every stop so the
 * falloff never straightens into an edge, and sized 34 by 56 per cent of the
 * box -- taller than wide, like the star -- so the light has the shape of the
 * thing throwing it without tracing its outline.
 *
 * Held below the sparkles in brightness on purpose. Around 0.4 it starts to
 * wash them out, and the sparkles are the detail worth seeing.
 */
const BLOOM_BOX_RATIO = 3.2;

function getBloomBackground(glowStrength: number) {
  const alpha = 0.22 + glowStrength * 0.1;
  const at = (fraction: number) => (alpha * fraction).toFixed(3);

  return `radial-gradient(ellipse 34% 56% at 50% 50%, rgba(255, 255, 255, ${alpha}) 0%, rgba(240, 236, 255, ${at(0.5)}) 16%, rgba(228, 222, 255, ${at(0.24)}) 32%, rgba(220, 208, 255, ${at(0.1)}) 50%, rgba(214, 196, 255, ${at(0.03)}) 70%, rgba(214, 196, 255, 0) 100%)`;
}

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
 * One per quadrant, jittered inside it, rather than a seeded angle anywhere on
 * the circle. The seeded version was badly biased: across 400 ids the quadrant
 * split came out 400 / 10 / 480 / 310, and for sequentially numbered ids it
 * picked the *same three* quadrants every time, so every star in a sky had an
 * empty top-left corner. A hash that is only used three or four times per star
 * is nowhere near enough samples to trust for coverage.
 *
 * Anchoring each sparkle to a quadrant centre and jittering by less than half a
 * quadrant guarantees all four are occupied while keeping stars unalike. The
 * seed still sets distance, size and timing, where a bias does no harm.
 *
 * The cycles are long and staggered, so the sparkles brighten at different
 * moments rather than together.
 */
function getSparkles(star: NormalizedStar, starSize: number) {
  const count = getSparkleCount(starSize);

  return Array.from({ length: count }, (_, index) => {
    // With two, they take opposite diagonals rather than adjacent ones, so a
    // small star still reads as lit on both sides instead of lopsided.
    const step = (Math.PI * 2) / count;
    const quadrantCentre = index * step + Math.PI / 4;
    const jitter = (getSeededFraction(star.id, index) - 0.5) * (step * 0.4);
    const angle = quadrantCentre + jitter;
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

/**
 * How long one breath takes.
 *
 * Long on purpose. At three seconds this read as a pulse; at five it still
 * registered as something happening. Around eight it drops below the threshold
 * where the eye tracks it, which is where a sky wants to be -- you notice that
 * it is alive without ever catching it moving.
 */
function getTwinkleDuration(star: NormalizedStar, isBackground: boolean) {
  const base = isBackground ? 8.8 : 8;
  const variation = (star.createdAt % 4) / 4 + ((star.id.length % 7) / 4);

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
  const sparkles = variant === "default" ? getSparkles(star, starSize) : [];
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
      {/* Behind the star and unmasked, so the light stands off it. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        aria-hidden="true"
        style={{
          width: `${starSize * BLOOM_BOX_RATIO}px`,
          height: `${starSize * BLOOM_BOX_RATIO}px`,
          transform: "translate(-50%, -50%)",
          background: getBloomBackground(glowStrength),
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: STAR_GRADIENT,
          /*
           * A background star is drawn the same as one in the sky.
           *
           * It used to be a tighter gradient at a lower opacity, and then had
           * three further dimmers stacked over it, so it arrived on screen as a
           * flat dot with no visible glow or twinkle. The background is meant
           * to be the same sky seen through the app, not a duller copy of it.
           */
          opacity: isPreview ? 0.92 : 0.86,
          filter: getStarGlowFilter(glowStrength, starSize),
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
            // Matches the floor in constellation-sparkle: a sparkle is always
            // faintly lit, so this is where it sits before its cycle starts.
            opacity: 0.3,
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
