"use client";

import { useEffect, useId, useRef } from "react";
import { NORTHERN_STAR_BOX, NORTHERN_STAR_PATH } from "@/components/ui/NorthernStar";

/**
 * Each plan as something in the night sky: Free is Jami's own star, Nova a
 * spiral galaxy, Celestial a grander barred spiral in gold and rose.
 *
 * The galaxies are painted in soft light, the way the Milky Way looks in a
 * long exposure: flowing arms built from blurred layers, fine filaments along
 * them, dark dust lanes on their inner edges and a glowing core. Points are
 * kept few and faint, because a galaxy made of dots read as grain rather than
 * light. Each is one canvas, painted once; only `animated` ones turn, by a
 * single transform, so the frame budget holds on an old iPad.
 *
 * Free uses Jami's star by choice (2 Oct 2026). It is the same path every
 * earned star draws (components/ui/NorthernStar.tsx), white, with its light
 * as a single drop shadow.
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
   * Set in a small window onto the night sky, so it reads on light themes too:
   * light drawn on light would vanish.
   */
  framed?: boolean;
  className?: string;
}) {
  const body =
    plan === "free" ? (
      <JamiStar size={framed ? size * 0.78 : size} />
    ) : (
      <Galaxy
        size={framed ? size * 1.18 : size}
        style={plan === "pro" ? CELESTIAL : NOVA}
        animated={animated}
        tilt={framed || size < 120 ? 40 : 58}
      />
    );
  if (!framed) {
    return (
      <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center ${className}`} style={{ width: size, height: size }}>
        {body}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full border border-white/15 bg-[radial-gradient(circle_at_50%_40%,#1d1650_0%,#0b0824_62%,#06041a_100%)] ${className}`}
      style={{ width: size, height: size }}
    >
      {body}
    </span>
  );
}

function JamiStar({ size }: { size: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox={`0 0 ${NORTHERN_STAR_BOX} ${NORTHERN_STAR_BOX}`}
      width={size}
      height={size}
      className="overflow-visible [filter:drop-shadow(0_0_6px_rgba(220,212,255,.85))]"
    >
      <defs>
        <radialGradient id={`${id}-light`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(214,204,255,.5)" />
          <stop offset="100%" stopColor="rgba(214,204,255,0)" />
        </radialGradient>
      </defs>
      <circle cx="80" cy="80" r="46" fill={`url(#${id}-light)`} />
      <path d={NORTHERN_STAR_PATH} fill="#ffffff" />
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
  wind: 2.6,
  bar: 0.14,
  core: [246, 240, 255],
  inner: [190, 174, 255],
  outer: [126, 146, 255],
  knots: [
    [198, 214, 255],
    [214, 190, 255],
  ],
  glow: 0.85,
};

const CELESTIAL: GalaxyStyle = {
  seed: 23,
  arms: 2,
  minorArms: 2,
  wind: 2.9,
  bar: 0.3,
  core: [255, 214, 160],
  inner: [255, 178, 222],
  outer: [160, 140, 255],
  knots: [
    [255, 152, 214],
    [255, 206, 170],
    [186, 200, 255],
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
  const glow = style.glow * (small ? 1.35 : 1);

  // Where an arm is at `t` (0 core, 1 tip): a spiral that winds tighter near
  // the core, so the arms sweep out of the bar rather than from a point.
  const point = (base: number, t: number, offset = 0) => {
    const angle = base + style.wind * Math.PI * Math.pow(t, 0.8);
    const r = radius * (style.bar * 0.55 + (1 - style.bar * 0.55) * t) * (1 + offset);
    return { x: c + Math.cos(angle) * r, y: c + Math.sin(angle) * r };
  };
  const arms: Array<{ base: number; weight: number }> = [];
  for (let arm = 0; arm < style.arms; arm += 1) {
    arms.push({ base: (arm / style.arms) * Math.PI * 2, weight: 1 });
  }
  for (let arm = 0; arm < style.minorArms; arm += 1) {
    arms.push({ base: ((arm + 0.5) / style.minorArms) * Math.PI * 2 + 0.3, weight: 0.35 });
  }

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

  // The faint disc everything sits in.
  const halo = ctx.createRadialGradient(c, c, 0, c, c, radius * 1.05);
  halo.addColorStop(0, rgba(style.inner, 0.2 * glow));
  halo.addColorStop(0.35, rgba(style.inner, 0.07 * glow));
  halo.addColorStop(1, rgba(style.outer, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";

  // The arms in three passes, widest and softest first: each drawn sharp on a
  // layer, then blurred onto the galaxy, so they flow as light.
  const passes = [
    { width: 0.26, alpha: 0.09, blur: 0.09 },
    { width: 0.12, alpha: 0.14, blur: 0.04 },
    { width: 0.04, alpha: 0.26, blur: 0.012 },
  ];
  const steps = small ? 60 : 140;
  for (const pass of passes) {
    clearLayer();
    lctx.globalCompositeOperation = "lighter";
    for (const arm of arms) {
      let previous = point(arm.base, 0.02);
      for (let step = 1; step <= steps; step += 1) {
        const t = 0.02 + (step / steps) * 0.98;
        const next = point(arm.base, t);
        // Faded in from the core, so the arms do not pile up into a white disc there.
        const fade = Math.min(1, t * 3.5) * Math.pow(1 - t, 0.6);
        lctx.strokeStyle = rgba(mix(style.inner, style.outer, t), pass.alpha * fade * arm.weight * glow);
        lctx.lineWidth = Math.max(0.6, radius * pass.width * (1 - t * 0.55));
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
    // Filaments: fine threads along each arm, a little in and out of it, which
    // is what makes the arms look like they are flowing.
    clearLayer();
    lctx.globalCompositeOperation = "lighter";
    for (const arm of arms) {
      const threads = arm.weight === 1 ? 9 : 4;
      for (let thread = 0; thread < threads; thread += 1) {
        const offset = (random() - 0.5) * 0.16;
        const start = 0.08 + random() * 0.25;
        const end = Math.min(0.98, start + 0.35 + random() * 0.45);
        lctx.lineWidth = 0.5 + random() * 0.7;
        lctx.beginPath();
        for (let step = 0; step <= 60; step += 1) {
          const t = start + ((end - start) * step) / 60;
          const p = point(arm.base, t, offset * (0.4 + t));
          if (step === 0) lctx.moveTo(p.x, p.y);
          else lctx.lineTo(p.x, p.y);
        }
        lctx.strokeStyle = rgba(mix(style.inner, [255, 255, 255], 0.35), 0.16 * arm.weight);
        lctx.stroke();
      }
    }
    blurInto(ctx, layer, 0.6, size);

    // Dust lanes on the inner edge of the main arms.
    clearLayer();
    for (const arm of arms.filter((candidate) => candidate.weight === 1)) {
      lctx.beginPath();
      for (let step = 0; step <= 80; step += 1) {
        const t = 0.12 + (step / 80) * 0.6;
        const p = point(arm.base - 0.2, t, -0.02);
        if (step === 0) lctx.moveTo(p.x, p.y);
        else lctx.lineTo(p.x, p.y);
      }
      lctx.strokeStyle = "rgba(8,4,26,.55)";
      lctx.lineWidth = radius * 0.03;
      lctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.6;
    blurInto(ctx, layer, radius * 0.02, size);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
  }

  // Star-forming knots along the arms.
  const knot = (x: number, y: number, r: number, colour: string) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, colour);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const knotCount = small ? 4 : style.minorArms ? 26 : 16;
  for (let index = 0; index < knotCount; index += 1) {
    const arm = arms[index % style.arms];
    const t = 0.25 + random() * 0.65;
    const p = point(arm.base, t, (random() - 0.5) * 0.08);
    const colour = style.knots[index % style.knots.length];
    knot(p.x, p.y, radius * (small ? 0.07 : 0.03 + random() * 0.025), rgba(colour, 0.5 + random() * 0.3));
  }

  // A sprinkle of single stars, kept sparse and faint so the light stays smooth.
  if (!small) {
    const count = Math.round(size * 1.4);
    for (let index = 0; index < count; index += 1) {
      const onArm = random() < 0.7;
      const t = Math.pow(random(), 0.9);
      const arm = arms[index % arms.length];
      const p = onArm
        ? point(arm.base, t, (random() - 0.5) * 0.22)
        : { x: c + (random() - 0.5) * radius * 2, y: c + (random() - 0.5) * radius * 2 };
      const alpha = (onArm ? 0.55 : 0.25) * (0.4 + random() * 0.6);
      ctx.fillStyle = rgba(mix([255, 255, 255], style.inner, random() * 0.5), alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.35 + random() * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The bar, where there is one: a long soft glow the arms leave from.
  if (style.bar > 0) {
    ctx.save();
    ctx.translate(c, c);
    ctx.scale(1, 0.32);
    const bar = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * style.bar * 1.1);
    bar.addColorStop(0, rgba(style.core, 0.75));
    bar.addColorStop(0.5, rgba(mix(style.core, style.inner, 0.4), 0.28));
    bar.addColorStop(1, rgba(style.inner, 0));
    ctx.fillStyle = bar;
    ctx.beginPath();
    ctx.arc(0, 0, radius * style.bar * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The core: a wide warm bloom, then a bright heart.
  knot(c, c, radius * 0.42, rgba(mix(style.core, style.inner, 0.3), 0.22 * glow));
  knot(c, c, radius * 0.18, rgba(style.core, 0.85));
  knot(c, c, radius * 0.07, "rgba(255,255,255,1)");
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

  return (
    <span className="inline-grid place-items-center [perspective:700px]" style={{ width: size, height: size }}>
      <canvas
        ref={ref}
        className={animated ? "plan-galaxy-spin" : undefined}
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
