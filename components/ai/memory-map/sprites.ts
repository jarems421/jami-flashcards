/**
 * The memory map's pictures, drawn once into offscreen canvases and reused
 * every frame: galaxies, note clouds, aurora light and soft points.
 *
 * Every glow here has a Gaussian falloff, so nothing on the map has a rim.
 */

import type { MemoryMapGalaxyForm } from "@/lib/ai/memory-map";
import { memoryMapHash, memoryMapRandom } from "@/lib/ai/memory-map";

export type RGB = [number, number, number];
type Random = () => number;
type Ctx = CanvasRenderingContext2D;

export const TAU = Math.PI * 2;
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t)),
];
export const rgba = (c: RGB, alpha: number) => `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
export const gauss = (random: Random) => (random() + random() + random() + random() - 2) * 0.87;

export function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(canvas: HTMLCanvasElement): Ctx {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available.");
  return ctx;
}

/** A soft round point with a white heart. */
export function dotSprite(color: RGB) {
  const S = 32, canvas = makeCanvas(S, S), g = context(canvas);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, rgba([255, 255, 255], 1));
  gr.addColorStop(0.18, rgba(color, 0.8));
  gr.addColorStop(0.5, rgba(color, 0.12));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return canvas;
}

function blobSprite(color: RGB) {
  const S = 64, canvas = makeCanvas(S, S), g = context(canvas);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, rgba(color, 1));
  gr.addColorStop(0.25, rgba(color, 0.55));
  gr.addColorStop(0.6, rgba(color, 0.12));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return canvas;
}

/** A note's cloud: soft, wispy and faint at heart, so it sits inside its galaxy. */
export function cloudSprite(color: RGB, seed: number) {
  const S = 180, canvas = makeCanvas(S, S), g = context(canvas), r = memoryMapRandom(seed), C = S / 2;
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 12; i++) {
    const angle = r() * TAU, d = r() * S * 0.18, x = C + Math.cos(angle) * d, y = C + Math.sin(angle) * d;
    const rad = S * (0.14 + r() * 0.22), a = 0.06 + r() * 0.1;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, rgba(color, a)); gr.addColorStop(0.5, rgba(color, a * 0.45)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
  }
  for (let i = 0; i < 4; i++) {
    g.save(); g.translate(C, C); g.rotate(r() * TAU); g.scale(1, 0.24 + r() * 0.2);
    const rad = S * (0.3 + r() * 0.15);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad);
    gr.addColorStop(0, rgba(color, 0.09)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rad, 0, TAU); g.fill(); g.restore();
  }
  const white = mix(color, [255, 255, 255], 0.72);
  const core = g.createRadialGradient(C, C, 0, C, C, S * 0.12);
  core.addColorStop(0, rgba(white, 0.22)); core.addColorStop(0.35, rgba(white, 0.08)); core.addColorStop(1, rgba(color, 0));
  g.fillStyle = core; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9; i++) {
    const angle = r() * TAU, d = Math.pow(r(), 0.7) * S * 0.3;
    g.fillStyle = rgba(white, 0.18 + r() * 0.3);
    g.beginPath(); g.arc(C + Math.cos(angle) * d, C + Math.sin(angle) * d, 0.5 + r() * 1.2, 0, TAU); g.fill();
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// Aurora light.
// ---------------------------------------------------------------------------

export type AuroraPalette = { fringe: RGB; body: RGB; mid: RGB; upper: RGB; crown: RGB };

/** Northern-lights colourings, so no two auroras look the same. */
export const AURORA_PALETTES: AuroraPalette[] = [
  { fringe: [255, 92, 178], body: [70, 255, 150], mid: [90, 230, 215], upper: [150, 105, 255], crown: [255, 80, 140] },
  { fringe: [150, 180, 255], body: [80, 235, 255], mid: [110, 170, 255], upper: [140, 110, 255], crown: [200, 110, 255] },
  { fringe: [255, 210, 130], body: [150, 255, 120], mid: [110, 240, 180], upper: [255, 190, 110], crown: [255, 130, 90] },
  { fringe: [255, 220, 240], body: [255, 110, 200], mid: [220, 120, 255], upper: [160, 100, 255], crown: [255, 80, 140] },
  { fringe: [120, 170, 255], body: [170, 120, 255], mid: [130, 110, 255], upper: [210, 120, 255], crown: [255, 100, 200] },
  { fringe: [255, 230, 150], body: [255, 140, 120], mid: [255, 120, 170], upper: [180, 100, 255], crown: [130, 90, 255] },
  { fringe: [200, 255, 240], body: [110, 255, 210], mid: [150, 210, 255], upper: [200, 160, 255], crown: [255, 150, 220] },
];

export function mixPalette(a: AuroraPalette, b: AuroraPalette, t: number): AuroraPalette {
  return {
    fringe: mix(a.fringe, b.fringe, t),
    body: mix(a.body, b.body, t),
    mid: mix(a.mid, b.mid, t),
    upper: mix(a.upper, b.upper, t),
    crown: mix(a.crown, b.crown, t),
  };
}

/**
 * One soft column of aurora light: a thin fringe at the foot, a bright lower
 * edge, a body fading upward through the palette. Many overlapping make a
 * curtain with no edges. `tint` leans the body toward the subjects it joins;
 * `crown` (0 to 1) warms the top.
 */
export function raySprite(palette: AuroraPalette, tint: RGB, crown: number) {
  const w = 16, h = 220, canvas = makeCanvas(w, h), g = context(canvas);
  const edge = mix(palette.body, [255, 255, 255], 0.6);
  const body = mix(palette.body, tint, 0.18), mid = mix(palette.mid, tint, 0.12);
  const upper = mix(palette.upper, palette.crown, crown * 0.5);
  const gr = g.createLinearGradient(0, h, 0, 0);
  gr.addColorStop(0, rgba(palette.fringe, 0));
  gr.addColorStop(0.035, rgba(palette.fringe, 0.5));
  gr.addColorStop(0.08, rgba(edge, 0.95));
  gr.addColorStop(0.16, rgba(body, 0.85));
  gr.addColorStop(0.36, rgba(body, 0.42));
  gr.addColorStop(0.55, rgba(mid, 0.22));
  gr.addColorStop(0.75, rgba(upper, 0.13));
  gr.addColorStop(0.9, rgba(palette.crown, 0.05 + crown * 0.04));
  gr.addColorStop(1, rgba(palette.crown, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "destination-in";
  const across = g.createLinearGradient(0, 0, w, 0);
  across.addColorStop(0, "rgba(0,0,0,0)"); across.addColorStop(0.3, "rgba(0,0,0,0.75)");
  across.addColorStop(0.5, "rgba(0,0,0,1)"); across.addColorStop(0.7, "rgba(0,0,0,0.75)"); across.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = across;
  g.fillRect(0, 0, w, h);
  return canvas;
}

// ---------------------------------------------------------------------------
// Galaxies.
// ---------------------------------------------------------------------------

export type GalaxyArm = { off: number; wind: number; f0: number; fmax: number; width: number; k: number };

/**
 * Each galaxy is drawn after a real one:
 * - whirlpool (M51): two clean arms and a small companion at the tip of one.
 * - pinwheel (M101): face-on, five loose, uneven arms full of pink knots.
 * - sombrero (M104): nearly edge-on, a big bulge, a thin ring and a dust lane.
 * - barred (NGC 1300): two long arms sweeping from the ends of a bright bar.
 * Arms are logarithmic spirals that rise out of the core and dissolve.
 */
export function galaxyArms(form: MemoryMapGalaxyForm, seed: string): GalaxyArm[] {
  const r = memoryMapRandom(memoryMapHash(`${seed}:arms`));
  if (form === "whirlpool") return [0, Math.PI].map((off) => ({ off, wind: 0.27, f0: 0.06, fmax: 1.02, width: 1, k: 1 }));
  if (form === "pinwheel") {
    return Array.from({ length: 5 }, (_, i) => ({
      off: (i * TAU) / 5 + (r() - 0.5) * 0.7, wind: 0.3 + r() * 0.16, f0: 0.06 + r() * 0.05,
      fmax: 0.6 + r() * 0.45, width: 0.85 + r() * 0.5, k: 0.55 + r() * 0.45,
    }));
  }
  if (form === "sombrero") return Array.from({ length: 3 }, (_, i) => ({ off: (i * TAU) / 3, wind: 0.09, f0: 0.55, fmax: 1, width: 0.7, k: 0.5 }));
  return [0, Math.PI].map((off) => ({ off, wind: 0.34, f0: 0.36, fmax: 1.05, width: 1.1, k: 1 }));
}

export function armAngle(arm: GalaxyArm, f: number) {
  return arm.off + Math.log(Math.max(f, arm.f0) / arm.f0) / arm.wind;
}

/** How bright an arm is at f: rising out of the core, dissolving at the tip. */
export function armEnv(arm: GalaxyArm, f: number) {
  const rise = clamp((f - arm.f0) / 0.1, 0, 1);
  const tail = clamp((arm.fmax - f) / (arm.fmax * 0.5), 0, 1);
  return rise * rise * (3 - 2 * rise) * Math.pow(tail, 1.4);
}

/** A point on an arm: along the spiral, spreading wider across it toward the rim. */
export function armPoint(arm: GalaxyArm, f: number, r: Random, RM: number): [number, number] {
  const a = armAngle(arm, f) + gauss(r) * 0.06;
  const rr = f * RM + gauss(r) * RM * (0.015 + 0.055 * f) * arm.width;
  return [Math.cos(a) * rr, Math.sin(a) * rr];
}

function softGlow(g: Ctx, x: number, y: number, radius: number, color: RGB, alpha: number, sy = 1) {
  g.save();
  g.translate(x, y);
  g.scale(1, sy);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, radius);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    gr.addColorStop(t, rgba(color, i === 10 ? 0 : alpha * Math.exp(-t * t * 5)));
  }
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, radius, 0, TAU); g.fill();
  g.restore();
}

/** Sprite size, and the share of it a galaxy's arms reach. */
export const GALAXY_SPRITE_SIZE = 600;
export const GALAXY_ARM_SHARE = 0.33;
export const CORE_SPRITE_SHARE = 0.47;

/** The soft heart of light at the centre of the map. */
export function coreSprite(tint: RGB, seed: string) {
  const S = GALAXY_SPRITE_SIZE, canvas = makeCanvas(S, S), g = context(canvas), r = memoryMapRandom(memoryMapHash(seed)), C = S / 2;
  const RM = S * CORE_SPRITE_SHARE;
  g.globalCompositeOperation = "lighter";
  let gr = g.createRadialGradient(C, C, 0, C, C, RM);
  gr.addColorStop(0, rgba(tint, 0.32)); gr.addColorStop(0.35, rgba(tint, 0.1)); gr.addColorStop(1, rgba(tint, 0));
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 140; i++) {
    const angle = r() * TAU, d = Math.pow(r(), 0.8) * RM * 0.8, x = C + Math.cos(angle) * d, y = C + Math.sin(angle) * d;
    const rad = S * (0.04 + r() * 0.1);
    const col: RGB = r() < 0.3 ? [255, 190, 230] : r() < 0.5 ? [150, 210, 255] : tint;
    const gg = g.createRadialGradient(x, y, 0, x, y, rad);
    gg.addColorStop(0, rgba(col, 0.08)); gg.addColorStop(1, rgba(col, 0));
    g.fillStyle = gg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 2600; i++) {
    const angle = r() * TAU, d = Math.pow(r(), 1.7) * RM;
    g.fillStyle = rgba(mix([255, 246, 236], tint, d / RM), 0.15 + r() * 0.5);
    g.fillRect(C + Math.cos(angle) * d, C + Math.sin(angle) * d, 0.6 + r() * 0.9, 0.6 + r() * 0.9);
  }
  gr = g.createRadialGradient(C, C, 0, C, C, S * 0.16);
  gr.addColorStop(0, "rgba(255,250,240,0.95)"); gr.addColorStop(0.18, "rgba(255,236,214,0.6)");
  gr.addColorStop(0.5, "rgba(255,214,184,0.16)"); gr.addColorStop(1, rgba(tint, 0));
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return canvas;
}

export function galaxySprite(input: { form: MemoryMapGalaxyForm; tint: RGB; squash: number; arms: GalaxyArm[]; seed: string }) {
  const S = GALAXY_SPRITE_SIZE, canvas = makeCanvas(S, S), g = context(canvas), C = S / 2;
  const r = memoryMapRandom(memoryMapHash(`${input.seed}:galaxy`));
  const RM = S * GALAXY_ARM_SHARE;
  const { arms, tint, form } = input;
  const sombrero = form === "sombrero";
  const tintBlob = blobSprite(tint);
  const paleBlob = blobSprite(mix(tint, [255, 255, 255], 0.4));
  const pinkBlob = blobSprite([255, 140, 200]);
  const blueBlob = blobSprite([150, 200, 255]);
  const darkBlob = blobSprite([0, 0, 0]);
  g.globalCompositeOperation = "lighter";

  softGlow(g, C, C, S * 0.49, tint, sombrero ? 0.14 : 0.1);
  softGlow(g, C, C, RM * 1.05, mix(tint, [255, 240, 220], 0.4), 0.16);

  const knotChance = form === "pinwheel" ? 0.03 : 0.012;
  // Many-armed galaxies share the light out, so they do not glare.
  const share = Math.sqrt(2 / arms.length);
  for (const arm of arms) {
    for (let f = arm.f0; f < arm.fmax; f += 0.003) {
      const env = armEnv(arm, f);
      if (env < 0.01) continue;
      const [x, y] = armPoint(arm, f, r, RM);
      const rad = RM * (0.05 + 0.13 * f) * arm.width;
      g.globalAlpha = 0.055 * share * arm.k * env * (0.7 + 0.3 * r());
      g.drawImage(f < 0.3 ? paleBlob : tintBlob, C + x - rad, C + y - rad, rad * 2, rad * 2);
      if (r() < knotChance && f > 0.2) {
        const k = rad * (0.22 + r() * 0.15);
        g.globalAlpha = 0.45 * env;
        g.drawImage(r() < 0.7 ? pinkBlob : blueBlob, C + x - k, C + y - k, k * 2, k * 2);
      }
    }
    for (let f = arm.f0; f < arm.fmax; f += 0.006) {
      const env = armEnv(arm, f);
      if (env < 0.01) continue;
      const a = armAngle(arm, f) + 0.35, rr = f * RM * 1.02, rad = RM * (0.08 + 0.16 * f) * arm.width;
      g.globalAlpha = 0.016 * arm.k * env;
      g.drawImage(tintBlob, C + Math.cos(a) * rr - rad, C + Math.sin(a) * rr - rad, rad * 2, rad * 2);
    }
  }

  if (form === "barred") {
    const half = RM * 0.38;
    for (let i = 0; i < 220; i++) {
      const x = (r() * 2 - 1) * half, y = gauss(r) * RM * 0.035;
      const rad = RM * (0.05 + 0.05 * (1 - Math.abs(x) / half));
      g.globalAlpha = 0.06;
      g.drawImage(paleBlob, C + x - rad, C + y - rad, rad * 2, rad * 2);
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = rgba([255, 236, 214], 0.2 + r() * 0.5);
      g.fillRect(C + (r() * 2 - 1) * half * 1.05, C + gauss(r) * RM * 0.04, 0.6 + r() * 0.8, 0.6 + r() * 0.8);
    }
  }
  g.globalAlpha = 1;

  for (let i = 0; i < 9000; i++) {
    let x: number, y: number, f: number;
    if (r() < 0.7) {
      const arm = arms[i % arms.length];
      f = arm.f0 + (arm.fmax - arm.f0) * Math.pow(r(), 1.1);
      if (r() > armEnv(arm, f)) continue;
      [x, y] = armPoint(arm, f, r, RM);
    } else {
      f = Math.min(1.1, -Math.log(1 - r() * 0.985) * (sombrero ? 0.34 : 0.24));
      const a = r() * TAU;
      x = Math.cos(a) * f * RM; y = Math.sin(a) * f * RM;
    }
    const blue = r() < 0.03;
    const col = blue ? ([200, 225, 255] as RGB) : f < 0.22 ? mix([255, 238, 214], tint, f * 2) : mix(tint, [255, 255, 255], 0.25 + r() * 0.35);
    const fade = Math.pow(clamp(1 - f / 1.1, 0, 1), 0.9);
    g.fillStyle = rgba(col, (blue ? 0.85 : 0.14 + r() * 0.5) * fade);
    const size = blue ? 1.5 : 0.5 + r() * 0.8;
    g.fillRect(C + x, C + y, size, size);
  }

  g.globalCompositeOperation = "destination-out";
  if (sombrero) {
    for (let a = 0.15; a < Math.PI - 0.15; a += 0.01) {
      for (const ring of [0.78, 0.84]) {
        const rr = ring * RM, rad = RM * 0.05;
        g.globalAlpha = 0.16 * Math.sin(a);
        g.drawImage(darkBlob, C + Math.cos(a) * rr - rad, C + Math.sin(a) * rr - rad, rad * 2, rad * 2);
      }
    }
  } else {
    for (const arm of arms) {
      for (let f = arm.f0 + 0.04; f < arm.fmax * 0.8; f += 0.006) {
        const a = armAngle(arm, f) - 0.13, rr = f * RM * 0.97, rad = RM * (0.02 + 0.035 * f);
        g.globalAlpha = 0.06 * armEnv(arm, f);
        g.drawImage(darkBlob, C + Math.cos(a) * rr - rad, C + Math.sin(a) * rr - rad, rad * 2, rad * 2);
      }
    }
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "lighter";

  const upright = sombrero ? (1 / input.squash) * 0.72 : 1;
  if (sombrero) softGlow(g, C, C, RM * 0.62, [255, 232, 200], 0.5, upright);
  softGlow(g, C, C, RM * (sombrero ? 0.3 : 0.26), [255, 244, 228], 0.9, upright);
  softGlow(g, C, C, RM * 0.07, [255, 252, 246], 0.9);

  if (form === "whirlpool") {
    const arm = arms[0], f = arm.fmax * 0.98, a = armAngle(arm, f) + 0.1;
    const cx = C + Math.cos(a) * f * RM * 1.04, cy = C + Math.sin(a) * f * RM * 1.04;
    softGlow(g, cx, cy, RM * 0.22, mix(tint, [255, 230, 200], 0.6), 0.35);
    softGlow(g, cx, cy, RM * 0.06, [255, 244, 226], 0.9);
  }

  if ("filter" in g) {
    const copy = makeCanvas(S, S);
    context(copy).drawImage(canvas, 0, 0);
    g.filter = "blur(9px)";
    g.globalAlpha = 0.5;
    g.drawImage(copy, 0, 0);
    g.filter = "none";
    g.globalAlpha = 1;
  }
  return canvas;
}

/**
 * Splits a galaxy into centre and outskirts with a soft mask. Drawn together
 * with "lighter" they add back up to the whole, but each can turn at its own
 * rate, which is what makes a galaxy look like it swirls.
 */
export function splitSprite(source: HTMLCanvasElement) {
  const S = source.width, C = S / 2, RM = S * GALAXY_ARM_SHARE;
  const mask = (g: Ctx) => {
    const m = g.createRadialGradient(C, C, 0, C, C, RM * 0.75);
    m.addColorStop(0, "rgba(0,0,0,1)"); m.addColorStop(0.45, "rgba(0,0,0,1)"); m.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = m;
    g.fillRect(0, 0, S, S);
  };
  const inner = makeCanvas(S, S), outer = makeCanvas(S, S);
  const gi = context(inner);
  gi.drawImage(source, 0, 0); gi.globalCompositeOperation = "destination-in"; mask(gi);
  const go = context(outer);
  go.drawImage(source, 0, 0); go.globalCompositeOperation = "destination-out"; mask(go);
  return { inner, outer };
}
