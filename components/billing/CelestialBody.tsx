"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Each plan as something in the night sky, drawn to look real rather than as
 * an icon: Free is a moon, Nova a ringed planet, Celestial a spiral galaxy.
 *
 * None of them is a star. A star in Jami means a goal the student earned
 * (docs/ui-design-system.md), and a plan is not that. The galaxy is points of
 * light on a canvas -- one element however many points -- and only turns
 * where `animated` is set, by a single transform, so the frame budget holds.
 */

type BodyPlan = "free" | "plus" | "pro";

export default function CelestialBody({
  plan,
  size,
  animated = false,
  className = "",
}: {
  plan: BodyPlan;
  size: number;
  /** The welcome: rings draw in and the galaxy turns. Off everywhere else. */
  animated?: boolean;
  className?: string;
}) {
  if (plan === "free") return <Moon size={size} className={className} />;
  if (plan === "plus") return <RingedPlanet size={size} animated={animated} className={className} />;
  return <Galaxy size={size} animated={animated} className={className} />;
}

function Moon({ size, className }: { size: number; className: string }) {
  const id = useId().replace(/:/g, "");
  const craters: Array<[number, number, number]> = [
    [40, 38, 6],
    [58, 56, 4.5],
    [44, 62, 3],
    [62, 38, 3.2],
    [33, 52, 2.4],
    [52, 46, 2],
    [68, 50, 2.2],
  ];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className={`overflow-visible ${className}`}>
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop offset="45%" stopColor="rgba(226,220,255,.32)" />
          <stop offset="100%" stopColor="rgba(226,220,255,0)" />
        </radialGradient>
        <radialGradient id={`${id}-body`} cx="36%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#f7f5ff" />
          <stop offset="38%" stopColor="#cfcae4" />
          <stop offset="72%" stopColor="#8e88ab" />
          <stop offset="100%" stopColor="#3f3a5c" />
        </radialGradient>
        <radialGradient id={`${id}-crater`} cx="62%" cy="66%" r="70%">
          <stop offset="0%" stopColor="#d9d5ec" />
          <stop offset="55%" stopColor="#8d87a8" />
          <stop offset="100%" stopColor="#6a6487" />
        </radialGradient>
        <radialGradient id={`${id}-shade`} cx="30%" cy="28%" r="90%">
          <stop offset="48%" stopColor="rgba(8,5,28,0)" />
          <stop offset="100%" stopColor="rgba(8,5,28,.72)" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="50" cy="50" r="30" />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#${id}-glow)`} />
      <circle cx="50" cy="50" r="30" fill={`url(#${id}-body)`} />
      <g clipPath={`url(#${id}-clip)`}>
        {/* Maria: the dark seas */}
        <ellipse cx="57" cy="42" rx="11" ry="8" fill="#6f6990" opacity="0.32" />
        <ellipse cx="42" cy="58" rx="9" ry="6" fill="#6f6990" opacity="0.26" />
        {craters.map(([x, y, r]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r={r} fill={`url(#${id}-crater)`} opacity="0.6" />
            <circle cx={x - r * 0.18} cy={y - r * 0.18} r={r * 0.82} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="0.5" />
          </g>
        ))}
        <circle cx="50" cy="50" r="30" fill={`url(#${id}-shade)`} />
      </g>
      <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(240,236,255,.35)" strokeWidth="0.6" />
    </svg>
  );
}

function RingedPlanet({ size, animated, className }: { size: number; animated: boolean; className: string }) {
  const id = useId().replace(/:/g, "");
  const ring = animated ? "plan-welcome-ring" : "";
  const ringEllipse = (clip: string, extra = "") => (
    <g clipPath={`url(#${id}-${clip})`}>
      <ellipse
        className={`${ring} ${extra}`}
        pathLength={1}
        cx="50"
        cy="50"
        rx="45"
        ry="12.5"
        fill="none"
        stroke={`url(#${id}-ring)`}
        strokeWidth="5.5"
      />
      <ellipse
        className={`${ring} ${extra}`}
        pathLength={1}
        cx="50"
        cy="50"
        rx="40.5"
        ry="11.2"
        fill="none"
        stroke="rgba(14,8,44,.55)"
        strokeWidth="0.8"
      />
    </g>
  );
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className={`overflow-visible ${className}`}>
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop offset="35%" stopColor="rgba(170,148,255,.42)" />
          <stop offset="100%" stopColor="rgba(170,148,255,0)" />
        </radialGradient>
        <radialGradient id={`${id}-body`} cx="34%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#f6f2ff" />
          <stop offset="30%" stopColor="#c6b8ff" />
          <stop offset="62%" stopColor="#7d66e6" />
          <stop offset="100%" stopColor="#251a63" />
        </radialGradient>
        <linearGradient id={`${id}-bands`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0)" />
          <stop offset="18%" stopColor="rgba(255,226,248,.28)" />
          <stop offset="26%" stopColor="rgba(40,22,120,.22)" />
          <stop offset="38%" stopColor="rgba(255,255,255,.14)" />
          <stop offset="50%" stopColor="rgba(60,34,150,.26)" />
          <stop offset="58%" stopColor="rgba(255,214,246,.22)" />
          <stop offset="70%" stopColor="rgba(40,22,120,.2)" />
          <stop offset="82%" stopColor="rgba(255,255,255,.1)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <radialGradient id={`${id}-shade`} cx="30%" cy="26%" r="92%">
          <stop offset="46%" stopColor="rgba(6,3,26,0)" />
          <stop offset="100%" stopColor="rgba(6,3,26,.75)" />
        </radialGradient>
        <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(201,188,255,.15)" />
          <stop offset="22%" stopColor="rgba(255,232,250,.92)" />
          <stop offset="50%" stopColor="rgba(214,200,255,.7)" />
          <stop offset="78%" stopColor="rgba(255,214,246,.85)" />
          <stop offset="100%" stopColor="rgba(201,188,255,.15)" />
        </linearGradient>
        <clipPath id={`${id}-far`} clipPathUnits="userSpaceOnUse">
          <rect x="-10" y="-10" width="120" height="60" />
        </clipPath>
        <clipPath id={`${id}-near`} clipPathUnits="userSpaceOnUse">
          <rect x="-10" y="50" width="120" height="60" />
        </clipPath>
        <clipPath id={`${id}-planet`}>
          <circle cx="50" cy="50" r="22" />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="48" fill={`url(#${id}-glow)`} />
      <g transform="rotate(-18 50 50)">
        {ringEllipse("far")}
        <circle cx="50" cy="50" r="22" fill={`url(#${id}-body)`} />
        <g clipPath={`url(#${id}-planet)`}>
          <rect x="20" y="28" width="60" height="44" fill={`url(#${id}-bands)`} />
          {/* The ring's shadow across the planet */}
          <ellipse cx="50" cy="55" rx="45" ry="12.5" fill="none" stroke="rgba(6,3,26,.26)" strokeWidth="3" />
          <circle cx="50" cy="50" r="22" fill={`url(#${id}-shade)`} />
        </g>
        <circle cx="50" cy="50" r="22" fill="none" stroke="rgba(214,200,255,.55)" strokeWidth="0.7" />
        {ringEllipse("near", animated ? "plan-welcome-ring-late" : "")}
      </g>
    </svg>
  );
}

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A two-armed spiral galaxy, drawn face-on to a canvas and tilted with CSS so
 * it can turn in its own plane: thousands of points scattered about
 * logarithmic arms, warm and dense at the core, violet and pink at the edge,
 * added together so where they crowd they glow.
 */
function Galaxy({ size, animated, className }: { size: number; animated: boolean; className: string }) {
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

    const random = seeded(29);
    const gaussian = () => {
      const u = Math.max(1e-6, random());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    };
    const c = size / 2;
    const radius = size * 0.47;
    // Small galaxies (a card's mark) need more light per point to read at all.
    const small = size < 120;
    const armAngle = (arm: number, t: number) => arm * Math.PI + t * Math.PI * 3.1;
    const blob = (x: number, y: number, r: number, colour: string) => {
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, colour);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    // The faint disc the arms sit in.
    const halo = ctx.createRadialGradient(c, c, 0, c, c, radius);
    halo.addColorStop(0, "rgba(255,236,246,.55)");
    halo.addColorStop(0.25, "rgba(196,168,255,.22)");
    halo.addColorStop(0.65, "rgba(110,84,220,.08)");
    halo.addColorStop(1, "rgba(110,84,220,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, size, size);

    ctx.globalCompositeOperation = "lighter";
    // Nebula light along each arm: soft overlapping glows, so the arms read as
    // gas and starlight rather than a scatter of dots.
    for (let arm = 0; arm < 2; arm += 1) {
      for (let step = 0; step < 90; step += 1) {
        const t = 0.06 + (step / 90) * 0.94;
        const angle = armAngle(arm, t) + gaussian() * 0.06;
        const r = t * radius;
        const x = c + Math.cos(angle) * r;
        const y = c + Math.sin(angle) * r;
        const warm = random() < 0.35;
        const alpha = (small ? 0.16 : 0.13) * (1 - t * 0.55);
        blob(x, y, radius * (0.2 - t * 0.08), warm ? `rgba(255,182,232,${alpha})` : `rgba(170,150,255,${alpha})`);
      }
    }

    // Dust lanes on the inner edge of each arm.
    ctx.globalCompositeOperation = "source-over";
    for (let arm = 0; arm < 2; arm += 1) {
      for (let step = 0; step < 70; step += 1) {
        const t = 0.12 + (step / 70) * 0.75;
        const angle = armAngle(arm, t) - 0.32;
        const r = t * radius * 0.97;
        blob(c + Math.cos(angle) * r, c + Math.sin(angle) * r, radius * 0.05, "rgba(12,6,34,.12)");
      }
    }

    // Starlight: most points hug the arms, some fill the disc between them.
    ctx.globalCompositeOperation = "lighter";
    const count = Math.max(700, Math.min(7000, Math.round(size * size * 0.18)));
    const dot = Math.max(small ? 0.5 : 0.3, size / 220);
    for (let index = 0; index < count; index += 1) {
      const inDisc = random() < 0.22;
      const t = Math.pow(random(), inDisc ? 0.6 : 0.9);
      const angle = inDisc
        ? random() * Math.PI * 2
        : armAngle(index % 2, t) + gaussian() * 0.42 * (1 - t * 0.4);
      const r = t * radius + gaussian() * radius * 0.02;
      const x = c + Math.cos(angle) * r;
      const y = c + Math.sin(angle) * r;
      const tint = random();
      const [red, green, blue] =
        t < 0.16
          ? [255, 236, 214]
          : tint < 0.45
            ? [206, 192, 255]
            : tint < 0.75
              ? [255, 204, 240]
              : [176, 196, 255];
      const alpha = (inDisc ? 0.35 : 1) * Math.min(1, 0.2 + (1 - t) * 0.6) * (0.45 + random() * 0.55);
      ctx.fillStyle = `rgba(${red},${green},${blue},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, dot * (0.35 + random() * 0.75), 0, Math.PI * 2);
      ctx.fill();
    }

    // Young clusters: a few bright pink and blue knots along the arms.
    for (let index = 0; index < (small ? 6 : 22); index += 1) {
      const t = 0.3 + random() * 0.6;
      const angle = armAngle(index % 2, t) + gaussian() * 0.08;
      const r = t * radius;
      blob(
        c + Math.cos(angle) * r,
        c + Math.sin(angle) * r,
        radius * (small ? 0.06 : 0.035),
        random() < 0.5 ? "rgba(255,170,226,.55)" : "rgba(170,200,255,.5)"
      );
    }

    // The bulge: warm, bright, and wider than a point.
    blob(c, c, radius * 0.42, "rgba(255,214,200,.42)");
    blob(c, c, radius * 0.16, "rgba(255,248,236,.95)");
    blob(c, c, radius * 0.06, "rgba(255,255,255,1)");
    ctx.globalCompositeOperation = "source-over";
  }, [size]);

  return (
    <span
      aria-hidden="true"
      className={`inline-grid place-items-center [perspective:600px] ${className}`}
      style={{ width: size, height: size }}
    >
      <canvas
        ref={ref}
        className={animated ? "plan-galaxy-spin" : undefined}
        // A card's small mark is tilted less, so its arms still show.
        style={{
          width: size,
          height: size,
          ...(animated ? {} : { transform: `rotateX(${size < 120 ? 38 : 56}deg) rotate(-24deg)` }),
        }}
      />
    </span>
  );
}
