"use client";

import { useEffect, useId, useRef } from "react";
import { NORTHERN_STAR_BOX, NORTHERN_STAR_PATH } from "@/components/ui/NorthernStar";

/**
 * Each plan as something in the night sky: Free is Jami's own star, Nova a
 * spiral galaxy, Celestial a grander barred spiral in gold and rose.
 *
 * The galaxies are painted in soft light, the way a spiral galaxy looks in a
 * long exposure: arms built from blurred layers whose brightness rises and
 * falls along them, mottled clouds, spurs feathering off the arms, broken
 * dust lanes on their inner edges, pink star-forming knots and a warm core.
 * Points are kept few and faint, because a galaxy made of dots read as grain.
 * Each is one canvas, painted once; only `animated` ones turn, by a single
 * transform, so the frame budget holds on an old iPad.
 *
 * Free uses Jami's star by choice (2 Oct 2026). It is the same path every
 * earned star draws (components/ui/NorthernStar.tsx), with its light as a
 * single drop shadow.
 */

type BodyPlan = "free" | "plus" | "pro";

export default function CelestialBody({
  plan,
  size,
  animated = false,
  framed = false,
  className = "",
}: {
  plan: BodyPlan;
  size: number;
  /** The welcome and the Plans hero: the galaxy turns slowly. Off everywhere else. */
  animated?: boolean;
  /**
   * Set in a small window onto the night sky. Without it the mark sits straight
   * on the page and adapts to light themes (see `.plan-mark-adaptive`).
   */
  framed?: boolean;
  className?: string;
}) {
  const body =
    plan === "free" ? (
      <JamiStar size={framed ? size * 0.78 : size * 0.86} onNight={framed} />
    ) : (
      <Galaxy
        size={framed ? size * 1.18 : size}
        style={plan === "pro" ? CELESTIAL : NOVA}
        animated={animated}
        tilt={size < 120 ? 34 : 56}
      />
    );
  if (!framed) {
    return (
      <span
        aria-hidden="true"
        className={`plan-mark-adaptive inline-grid shrink-0 place-items-center ${className}`}
        style={{ width: size, height: size }}
      >
        {body}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block shrink-0 overflow-hidden rounded-full border border-white/15 bg-[radial-gradient(circle_at_50%_40%,#1d1650_0%,#0b0824_62%,#06041a_100%)] ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Centred absolutely: the galaxy is larger than its window, and a grid
          would grow its track and push it down and to the right. */}
      <span className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center">{body}</span>
    </span>
  );
}

/**
 * White on the night sky; on the page it takes the theme's text colour, the
 * way the walkthrough's star trail does, so it never vanishes on a light theme.
 */
function JamiStar({ size, onNight }: { size: number; onNight: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox={`0 0 ${NORTHERN_STAR_BOX} ${NORTHERN_STAR_BOX}`}
      width={size}
      height={size}
      className={`overflow-visible ${
        onNight
          ? "[filter:drop-shadow(0_0_6px_rgba(220,212,255,.85))]"
          : "[filter:drop-shadow(0_0_6px_var(--color-accent))]"
      }`}
    >
      <defs>
        <radialGradient id={`${id}-light`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={onNight ? "rgba(214,204,255,.5)" : "var(--color-accent-muted)"} />
          <stop offset="100%" stopColor="rgba(214,204,255,0)" />
        </radialGradient>
      </defs>
      <circle cx="80" cy="80" r="46" fill={`url(#${id}-light)`} />
      <path d={NORTHERN_STAR_PATH} fill={onNight ? "#ffffff" : "var(--color-text-primary)"} />
    </svg>
  );
}

type Rgb = readonly [number, number, number];

type GalaxyStyle = {
  seed: number;
  /** Main arms, then fainter arms between them. */
  arms: number;
  minorArms: number;
  /** How many half-turns each arm makes from the core to its tip. */
  wind: number;
  /** Length of the central bar as a share of the radius; 0 for none. */
  bar: number;
  core: Rgb;
  inner: Rgb;
  outer: Rgb;
  knots: readonly Rgb[];
  glow: number;
};

const NOVA: GalaxyStyle = {
  seed: 7,
  arms: 2,
  minorArms: 0,
  wind: 2.4,
  bar: 0.16,
  core: [255, 236, 214],
  inner: [182, 188, 255],
  outer: [118, 150, 255],
  knots: [
    [255, 176, 224],
    [196, 214, 255],
  ],
  glow: 0.78,
};

const CELESTIAL: GalaxyStyle = {
  seed: 23,
  arms: 2,
  minorArms: 2,
  wind: 2.7,
  bar: 0.3,
  core: [255, 212, 150],
  inner: [255, 172, 222],
  outer: [166, 140, 255],
  knots: [
    [255, 140, 210],
    [255, 206, 160],
    [204, 184, 255],
  ],
  glow: 0.95,
};

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgba([r, g, b]: Rgb, alpha: number) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Draws one layer onto `target` blurred: with canvas filters where the browser has them, by offset copies where not. */
function blurInto(target: CanvasRenderingContext2D, layer: HTMLCanvasElement, blur: number, size: number) {
  if (blur <= 0.2) {
    target.drawImage(layer, 0, 0, size, size);
    return;
  }
  // Older Safari has no canvas filter: the property is simply missing.
  if (typeof (target as { filter?: unknown }).filter === "string") {
    target.filter = `blur(${blur.toFixed(2)}px)`;
    target.drawImage(layer, 0, 0, size, size);
    target.filter = "none";
    return;
  }
  const copies = 8;
  const alpha = target.globalAlpha;
  target.globalAlpha = alpha / copies;
  for (let index = 0; index < copies; index += 1) {
    const angle = (index / copies) * Math.PI * 2;
    target.drawImage(layer, Math.cos(angle) * blur * 0.6, Math.sin(angle) * blur * 0.6, size, size);
  }
  target.globalAlpha = alpha;
}

function paintGalaxy(ctx: CanvasRenderingContext2D, size: number, dpr: number, style: GalaxyStyle) {
  const random = seeded(style.seed);
  const c = size / 2;
  const radius = size * 0.46;
  const small = size < 110;
  const glow = style.glow * (small ? 1.3 : 1);
  const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  // Where an arm is at `t` (0 core, 1 tip): a spiral that winds tighter near
  // the core, so the arms sweep out of the bar rather than from a point.
  const point = (base: number, t: number, offset = 0) => {
    const angle = base + style.wind * Math.PI * Math.pow(t, 0.8);
    const r = radius * (style.bar * 0.55 + (1 - style.bar * 0.55) * t) * (1 + offset);
    return { x: c + Math.cos(angle) * r, y: c + Math.sin(angle) * r };
  };
  // Arm colour: warm where it leaves the core, then the arm's own colours outwards.
  const armColour = (t: number) =>
    mix(mix(style.core, style.inner, smoothstep(0.02, 0.32, t)), style.outer, smoothstep(0.35, 1, t));

  type Arm = { base: number; weight: number; reach: number; phases: [number, number, number] };
  const arms: Arm[] = [];
  const phases = (): [number, number, number] => [random() * 6.28, random() * 6.28, random() * 6.28];
  for (let arm = 0; arm < style.arms; arm += 1) {
    arms.push({ base: (arm / style.arms) * Math.PI * 2, weight: 1, reach: 1, phases: phases() });
  }
  for (let arm = 0; arm < style.minorArms; arm += 1) {
    arms.push({
      base: ((arm + 0.5) / style.minorArms) * Math.PI * 2 + 0.35,
      weight: 0.32,
      reach: 0.78,
      phases: phases(),
    });
  }
  // Brightness rising and falling along an arm, so it reads as clumps of
  // starlight rather than a smooth tube.
  const brightness = (arm: Arm, t: number) =>
    0.62 +
    0.22 * Math.sin(t * 13 + arm.phases[0]) +
    0.12 * Math.sin(t * 29 + arm.phases[1]) +
    0.06 * Math.sin(t * 53 + arm.phases[2]);

  const layer = document.createElement("canvas");
  layer.width = Math.round(size * dpr);
  layer.height = Math.round(size * dpr);
  const lctx = layer.getContext("2d");
  if (!lctx) return;
  lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  lctx.lineCap = "round";
  const clearLayer = () => {
    lctx.globalCompositeOperation = "source-over";
    lctx.clearRect(0, 0, size, size);
  };
  const blob = (target: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string) => {
    const gradient = target.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, colour);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    target.fillStyle = gradient;
    target.beginPath();
    target.arc(x, y, r, 0, Math.PI * 2);
    target.fill();
  };

  // The faint disc everything sits in.
  const halo = ctx.createRadialGradient(c, c, 0, c, c, radius * 1.05);
  halo.addColorStop(0, rgba(style.inner, 0.18 * glow));
  halo.addColorStop(0.4, rgba(style.outer, 0.06 * glow));
  halo.addColorStop(1, rgba(style.outer, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";

  // The arms in three passes, widest and softest first: each drawn sharp on a
  // layer, then blurred onto the galaxy, so they flow as light.
  const passes = [
    { width: 0.3, alpha: 0.08, blur: 0.1 },
    { width: 0.13, alpha: 0.13, blur: 0.045 },
    { width: 0.045, alpha: 0.22, blur: 0.014 },
  ];
  const steps = small ? 60 : 160;
  for (const pass of passes) {
    clearLayer();
    lctx.globalCompositeOperation = "lighter";
    for (const arm of arms) {
      let previous = point(arm.base, 0.02);
      for (let step = 1; step <= steps; step += 1) {
        const t = 0.02 + (step / steps) * (arm.reach - 0.02);
        const next = point(arm.base, t);
        const fade = smoothstep(0, 0.28, t) * Math.pow(Math.max(0, 1 - t / arm.reach), 0.55);
        lctx.strokeStyle = rgba(armColour(t), pass.alpha * fade * arm.weight * glow * brightness(arm, t));
        lctx.lineWidth = Math.max(0.6, radius * pass.width * (1 - t * 0.5));
        lctx.beginPath();
        lctx.moveTo(previous.x, previous.y);
        lctx.lineTo(next.x, next.y);
        lctx.stroke();
        previous = next;
      }
    }
    blurInto(ctx, layer, radius * pass.blur, size);
  }

  if (!small) {
    // Mottled clouds along the arms, and spurs feathering outwards from them.
    clearLayer();
    lctx.globalCompositeOperation = "lighter";
    for (const arm of arms.filter((candidate) => candidate.weight === 1)) {
      for (let index = 0; index < 120; index += 1) {
        const t = 0.1 + Math.pow(random(), 0.85) * 0.85;
        const spread = (random() + random() - 1) * 0.07 * (1 + t);
        const p = point(arm.base, t, spread);
        const r = radius * (0.02 + random() * 0.04) * (1 - t * 0.3);
        blob(lctx, p.x, p.y, r, rgba(mix(armColour(t), [255, 255, 255], 0.2), 0.09 * brightness(arm, t)));
      }
      for (let spur = 0; spur < 8; spur += 1) {
        const t = 0.3 + (spur / 8) * 0.55 + random() * 0.04;
        lctx.beginPath();
        for (let step = 0; step <= 12; step += 1) {
          const s = step / 12;
          const p = point(arm.base, t + s * 0.07, s * (0.12 + random() * 0.03));
          if (step === 0) lctx.moveTo(p.x, p.y);
          else lctx.lineTo(p.x, p.y);
        }
        lctx.strokeStyle = rgba(armColour(t), 0.14);
        lctx.lineWidth = radius * 0.035;
        lctx.stroke();
      }
    }
    blurInto(ctx, layer, radius * 0.018, size);

    // Dust lanes along the inner edge of the main arms, broken where the arm thins.
    clearLayer();
    for (const arm of arms.filter((candidate) => candidate.weight === 1)) {
      let previous = point(arm.base - 0.2, 0.12, -0.02);
      for (let step = 1; step <= 90; step += 1) {
        const t = 0.12 + (step / 90) * 0.62;
        const next = point(arm.base - 0.2, t, -0.02);
        const lane = brightness(arm, t * 1.3 + 0.2);
        if (lane > 0.5) {
          lctx.strokeStyle = `rgba(8,4,26,${(0.55 * smoothstep(0.5, 0.8, lane)).toFixed(3)})`;
          lctx.lineWidth = radius * 0.024;
          lctx.beginPath();
          lctx.moveTo(previous.x, previous.y);
          lctx.lineTo(next.x, next.y);
          lctx.stroke();
        }
        previous = next;
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.65;
    blurInto(ctx, layer, radius * 0.016, size);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
  }

  // Star-forming knots, on the outer edge of the arms where they belong.
  const knotCount = small ? 4 : style.minorArms ? 30 : 20;
  for (let index = 0; index < knotCount; index += 1) {
    const arm = arms[index % style.arms];
    const t = 0.28 + random() * 0.62;
    const p = point(arm.base, t, 0.02 + random() * 0.05);
    const colour = style.knots[index % style.knots.length];
    const r = radius * (small ? 0.07 : 0.012 + random() * 0.022);
    blob(ctx, p.x, p.y, r * 2.2, rgba(colour, 0.22));
    blob(ctx, p.x, p.y, r, rgba(mix(colour, [255, 255, 255], 0.4), 0.75));
  }

  // A sprinkle of single stars, sparse and faint so the light stays smooth:
  // bluish in the arms, warmer near the core.
  if (!small) {
    const count = Math.round(size * 1.6);
    for (let index = 0; index < count; index += 1) {
      const onArm = random() < 0.72;
      const t = Math.pow(random(), 0.9);
      const arm = arms[index % arms.length];
      const p = onArm
        ? point(arm.base, t * arm.reach, (random() + random() - 1) * 0.12)
        : { x: c + (random() - 0.5) * radius * 2.1, y: c + (random() - 0.5) * radius * 2.1 };
      const tint = t < 0.25 ? mix([255, 236, 210], [255, 255, 255], random()) : mix([206, 220, 255], [255, 255, 255], random());
      ctx.fillStyle = rgba(tint, (onArm ? 0.6 : 0.22) * (0.35 + random() * 0.65));
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.3 + random() * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The bar, where there is one: a long soft glow the arms leave from.
  if (style.bar > 0) {
    ctx.save();
    ctx.translate(c, c);
    ctx.scale(1, 0.34);
    const length = radius * style.bar * 1.15;
    const bar = ctx.createRadialGradient(0, 0, 0, 0, 0, length);
    bar.addColorStop(0, rgba(style.core, 0.7));
    bar.addColorStop(0.5, rgba(mix(style.core, style.inner, 0.4), 0.24));
    bar.addColorStop(1, rgba(style.inner, 0));
    ctx.fillStyle = bar;
    ctx.beginPath();
    ctx.arc(0, 0, length, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The core: a wide warm bulge, then a bright heart.
  blob(ctx, c, c, radius * 0.4, rgba(mix(style.core, style.inner, 0.25), 0.24 * glow));
  blob(ctx, c, c, radius * 0.17, rgba(style.core, 0.85));
  blob(ctx, c, c, radius * 0.06, "rgba(255,255,255,1)");
  ctx.globalCompositeOperation = "source-over";
}

function Galaxy({
  size,
  style,
  animated,
  tilt,
}: {
  size: number;
  style: GalaxyStyle;
  animated: boolean;
  tilt: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    paintGalaxy(ctx, size, dpr, style);
  }, [size, style]);

  // No perspective: with it the near half of a tilted galaxy drew larger than
  // the far half, and the core sat visibly below the middle.
  return (
    <span className="inline-grid place-items-center" style={{ width: size, height: size }}>
      <canvas
        ref={ref}
        className={`plan-galaxy${animated ? " plan-galaxy-spin" : ""}`}
        style={
          {
            width: size,
            height: size,
            "--galaxy-tilt": `${tilt}deg`,
            ...(animated ? {} : { transform: `rotateX(${tilt}deg) rotate(-24deg)` }),
          } as React.CSSProperties
        }
      />
    </span>
  );
}
