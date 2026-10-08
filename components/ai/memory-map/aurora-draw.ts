/**
 * Drawing one aurora between two linked subjects on the memory map.
 *
 * Everything it needs from the engine -- where the camera is, how far into a
 * galaxy it has gone, the time -- is handed in as one frame, so the engine
 * decides what is drawn and this only draws it.
 */

import { TAU, clamp, mix, rgba } from "@/components/ai/memory-map/sprites";
import { WHITE, type Aurora } from "@/components/ai/memory-map/world";

/** What drawing an aurora needs to know about the frame it is drawn in. */
export type AuroraFrame = {
  /** World to screen, in CSS pixels. */
  w2s: (x: number, y: number) => [number, number];
  /** Seconds of animation so far; still while motion is reduced. */
  time: number;
  zoom: number;
  /** The zoom at which the whole map fits. */
  universeZoom: number;
  rotation: number;
  dpr: number;
  reducedMotion: boolean;
  /** How much of the curtains shows: they fade as the camera goes into a galaxy. */
  curtain: number;
  /** How much of the foot shows, which stays from inside a galaxy. */
  footAlpha: number;
  footDot: HTMLCanvasElement;
  sparkleDot: HTMLCanvasElement;
};

function quad(p: Aurora, t: number): [number, number] {
  const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
  return [a * p.p0[0] + b * p.p1[0] + c * p.p2[0], a * p.p0[1] + b * p.p1[1] + c * p.p2[1]];
}

function quadTangent(p: Aurora, t: number): [number, number] {
  const x = 2 * (1 - t) * (p.p1[0] - p.p0[0]) + 2 * t * (p.p2[0] - p.p1[0]);
  const y = 2 * (1 - t) * (p.p1[1] - p.p0[1]) + 2 * t * (p.p2[1] - p.p1[1]);
  const d = Math.hypot(x, y) || 1;
  return [x / d, y / d];
}

/** Slow, smooth wobble between 0 and 1: only long waves, so nothing spikes. */
function swell(x: number) {
  return 0.5 + 0.5 * (0.6 * Math.sin(x) + 0.4 * Math.sin(x * 1.73 + 1.1));
}

/**
 * An aurora: a glowing thread along its foot, up to three curtains rising
 * from it, and tiny sparkles caught in it. Its foot stays visible from
 * inside a galaxy, because a link to another subject leaves along it.
 *
 * `glow` is how bright it is drawn: its own glow, raised while the selected
 * note is linked across it.
 */
export function drawAurora(ctx: CanvasRenderingContext2D, p: Aurora, glow: number, frame: AuroraFrame) {
  const { w2s, time: T, zoom, dpr, curtain, footAlpha } = frame;
  const k = glow;
  const a = curtain * k;
  const ph = p.seed;
  const [ax, ay] = w2s(p.p0[0], p.p0[1]), [bx, by] = w2s(p.p2[0], p.p2[1]);
  const lenPx = Math.hypot(bx - ax, by - ay) * 1.15;
  const N = Math.round(clamp(lenPx / 2.6, 40, 170));
  const pts: { x: number; y: number; sx: number; sy: number; nx: number; ny: number; env: number; t: number }[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const env = Math.pow(Math.sin(Math.PI * t), 1.1);
    const P = quad(p, t), Tn = quadTangent(p, t);
    let nx = -Tn[1], ny = Tn[0];
    if (nx * P[0] + ny * P[1] < 0) { nx = -nx; ny = -ny; }
    const F = p.fold;
    const sway = env * F.amp * (Math.sin(t * TAU * F.f1 + T * F.speed + ph) + 0.38 * Math.sin(t * TAU * F.f2 - T * F.speed * 1.6 + ph * 1.7));
    const x = P[0] + nx * sway, y = P[1] + ny * sway;
    const [sx, sy] = w2s(x, y);
    pts.push({ x, y, sx, sy, nx, ny, env, t });
  }

  const thread = new Path2D();
  pts.forEach((q, i) => (i ? thread.lineTo(q.sx, q.sy) : thread.moveTo(q.sx, q.sy)));
  const gradient = ctx.createLinearGradient(ax, ay, bx, by);
  const cA = mix(p.A.tint, p.palette.body, 0.5), cB = mix(p.B.tint, p.palette.body, 0.5);
  gradient.addColorStop(0, rgba(cA, 0.55)); gradient.addColorStop(0.15, rgba(cA, 1));
  gradient.addColorStop(0.5, rgba(mix(p.palette.body, WHITE, 0.3), 1));
  gradient.addColorStop(0.85, rgba(cB, 1)); gradient.addColorStop(1, rgba(cB, 0.55));
  ctx.strokeStyle = gradient;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const zs = Math.min(3, Math.sqrt(zoom / frame.universeZoom));
  for (const [w, al] of [[24, 0.03], [10, 0.05], [3, 0.08], [1.2, 0.12]]) {
    ctx.globalAlpha = clamp(footAlpha * k * al, 0, 1);
    ctx.lineWidth = w * zs * p.thick;
    ctx.stroke(thread);
  }
  for (const q of [pts[0], pts[N - 1]]) {
    ctx.globalAlpha = clamp(footAlpha * k * 0.55, 0, 1);
    const D = 16 * zs;
    ctx.drawImage(frame.footDot, q.sx - D / 2, q.sy - D / 2, D, D);
  }
  if (a <= 0.01) return;

  for (let strand = 0; strand < p.layers; strand++) {
    const step = strand ? 2 : 1;
    const hMul = [1, 0.66, 0.45][strand], aMul = [1, 0.6, 0.45][strand], lift = [0, 10, -8][strand], ph2 = ph + strand * 2.4;
    const slice = Math.max(6, (lenPx / N) * 4.4 * step);
    for (let i = 0; i < N; i += step) {
      const q = pts[i];
      if (q.env < 0.03) continue;
      const h = p.height * hMul * q.env * (0.5 + 0.5 * swell(q.t * 5 + T * 0.25 + ph2));
      const hp = h * zoom;
      if (hp < 2) continue;
      const rays = 0.62 + 0.38 * swell(q.t * 34 + T * 0.12 + ph2 * 3);
      ctx.globalAlpha = clamp(a * aMul * q.env * 0.5 * rays * (0.6 + 0.4 * swell(q.t * 7 - T * 0.3 + ph2 * 1.3)), 0, 1);
      const [sx, sy] = lift ? w2s(q.x + q.nx * lift, q.y + q.ny * lift) : [q.sx, q.sy];
      const angle = Math.atan2(q.nx, -q.ny) + frame.rotation;
      const c = Math.cos(angle), s = Math.sin(angle);
      ctx.setTransform(dpr * c, dpr * s, -dpr * s, dpr * c, dpr * sx, dpr * sy);
      ctx.drawImage(p.rays[Math.round(q.t * 6)], -slice / 2, -hp * 0.9, slice, hp);
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  for (const sparkle of p.sparkles) {
    const q = pts[Math.round(sparkle.t * (N - 1))];
    if (q.env < 0.05) continue;
    const h = p.height * q.env * (0.5 + 0.5 * swell(q.t * 5 + T * 0.25 + ph)) * sparkle.h;
    const [sx, sy] = w2s(q.x + q.nx * h, q.y + q.ny * h);
    const tw = frame.reducedMotion ? 0.7 : 0.5 + 0.5 * Math.sin(T * sparkle.sp + sparkle.ph);
    ctx.globalAlpha = clamp(a * q.env * tw * tw, 0, 1);
    const D = 2 + sparkle.sz * 2.4;
    ctx.drawImage(frame.sparkleDot, sx - D / 2, sy - D / 2, D, D);
  }
}
