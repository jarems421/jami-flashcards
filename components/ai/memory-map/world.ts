/**
 * What the memory map is made of, before any of it is drawn: each galaxy's
 * pictures and stars, and the auroras between linked subjects.
 *
 * Built once per model from the layout in `lib/ai/memory-map.ts`, every random
 * draw seeded from the subject or link it belongs to, so the same notes always
 * make the same sky.
 */

import type { TutorMemoryKind } from "@/lib/ai/tutor-memory";
import { memoryMapHash, memoryMapRandom, type MemoryMapNote, type MemoryMapSystem } from "@/lib/ai/memory-map";
import {
  AURORA_PALETTES,
  TAU,
  armEnv,
  armPoint,
  cloudSprite,
  coreSprite,
  galaxyArms,
  galaxySprite,
  mix,
  mixPalette,
  raySprite,
  splitSprite,
  type AuroraPalette,
  type GalaxyArm,
  type RGB,
} from "@/components/ai/memory-map/sprites";

/** Each kind's colour, shared with the note card. */
export const MEMORY_KIND_COLOURS: Record<TutorMemoryKind, RGB> = {
  mistake: [255, 111, 142],
  struggle: [255, 194, 102],
  plan: [98, 220, 255],
  goal: [255, 224, 138],
  preference: [184, 168, 255],
  context: [236, 230, 255],
  strength: [157, 255, 208],
};

export type Particle = { r0: number; a0: number; sz: number; b: number; ph: number; sp: number; col?: string };
export type Mist = { r0: number; a0: number; size: number; rot: number };

export type MapNote = MemoryMapNote & {
  system: MapSystem;
  r0: number;
  a0: number;
  sx: number;
  sy: number;
  px: number;
  variant: number;
};

export type MapSystem = Omit<MemoryMapSystem, "notes"> & {
  notes: MapNote[];
  arms: GalaxyArm[];
  sprite: HTMLCanvasElement;
  inner: HTMLCanvasElement | null;
  outer: HTMLCanvasElement | null;
  point: HTMLCanvasElement;
  mistSprite: HTMLCanvasElement;
  clouds: Partial<Record<TutorMemoryKind, HTMLCanvasElement[]>>;
  dust: Particle[];
  fine: Particle[];
  mist: Mist[];
  spin: number;
  spinIn: number;
  noteSpin: number;
  label: HTMLButtonElement;
  pointer: HTMLButtonElement;
  pointerMeta: HTMLSpanElement;
};

export type Aurora = {
  key: string;
  A: MapSystem;
  B: MapSystem;
  count: number;
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  seed: number;
  rays: HTMLCanvasElement[];
  palette: AuroraPalette;
  layers: number;
  height: number;
  glow: number;
  thick: number;
  fold: { f1: number; f2: number; amp: number; speed: number };
  sparkles: { t: number; h: number; sz: number; ph: number; sp: number }[];
};

type SystemPictures = { sprite: HTMLCanvasElement; inner: HTMLCanvasElement | null; outer: HTMLCanvasElement | null };

/** Pictures are slow to draw, so each galaxy's are kept for as long as it looks the same. */
const spriteCache = new Map<string, SystemPictures>();
const cloudCache = new Map<string, HTMLCanvasElement[]>();

export const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
export const WHITE: RGB = [255, 255, 255];

/** A galaxy's arms, its picture, and a cloud for each kind of note it holds. */
export function systemPictures(source: MemoryMapSystem) {
  const key = `${source.id}:${source.core}:${source.form}:${source.tint.join(",")}:${source.squash}`;
  const arms = source.core ? [] : galaxyArms(source.form, source.id);
  let pictures = spriteCache.get(key);
  if (!pictures) {
    if (source.core) {
      pictures = { sprite: coreSprite(source.tint, source.id), inner: null, outer: null };
    } else {
      const sprite = galaxySprite({ form: source.form, tint: source.tint, squash: source.squash, arms, seed: source.id });
      const { inner, outer } = splitSprite(sprite);
      pictures = { sprite, inner, outer };
    }
    spriteCache.set(key, pictures);
  }
  const clouds: Partial<Record<TutorMemoryKind, HTMLCanvasElement[]>> = {};
  for (const kind of new Set(source.notes.map((note) => note.kind))) {
    const cloudKey = `${kind}:${source.tint.join(",")}`;
    let set = cloudCache.get(cloudKey);
    if (!set) {
      set = [0, 1].map((i) => cloudSprite(mix(MEMORY_KIND_COLOURS[kind], source.tint, 0.5), memoryMapHash(kind + source.id) + i * 97));
      cloudCache.set(cloudKey, set);
    }
    clouds[kind] = set;
  }
  return { arms, pictures, clouds };
}

/** A galaxy's dust, its fine stars and its mist, laid along its arms. */
export function systemStars(source: MemoryMapSystem, arms: GalaxyArm[]) {
  const r = memoryMapRandom(memoryMapHash(`${source.id}:dust`));
  const RM = source.R * 1.06;
  const dust: Particle[] = [];
  for (let i = 0; i < (source.core ? 160 : 320); i++) {
    let x: number, y: number;
    if (source.core || r() < 0.3) {
      const rr = Math.pow(r(), 1.2) * RM * (source.core ? 1 : 0.8), a = r() * TAU;
      x = Math.cos(a) * rr; y = Math.sin(a) * rr;
    } else {
      const arm = arms[i % arms.length];
      [x, y] = armPoint(arm, arm.f0 + (arm.fmax - arm.f0) * Math.pow(r(), 1.1), r, RM);
    }
    dust.push({ r0: Math.hypot(x, y), a0: Math.atan2(y, x), sz: 0.6 + r() * 1.1, b: 0.25 + r() * 0.7, ph: r() * TAU, sp: 0.6 + r() * 2 });
  }
  // Fine stars, drawn only up close: arriving, the galaxy resolves into sharp points.
  const rf = memoryMapRandom(memoryMapHash(`${source.id}:fine`));
  const fine: Particle[] = [];
  for (let i = 0; i < 1800; i++) {
    let x: number, y: number;
    if (source.core || rf() < 0.25) {
      const rr = Math.pow(rf(), 1.4) * RM, a = rf() * TAU;
      x = Math.cos(a) * rr; y = Math.sin(a) * rr;
    } else {
      const arm = arms[i % arms.length];
      const f = arm.f0 + (arm.fmax - arm.f0) * Math.pow(rf(), 1.1);
      if (rf() > armEnv(arm, f) * 1.1) continue;
      [x, y] = armPoint(arm, f, rf, RM);
    }
    const centre = Math.hypot(x, y) < RM * 0.25;
    fine.push({
      r0: Math.hypot(x, y), a0: Math.atan2(y, x), b: 0.35 + rf() * 0.65, sz: 0.6 + rf() * rf() * 1.6,
      ph: rf() * TAU, sp: 0.5 + rf() * 2.5,
      col: rgb(centre ? mix([255, 236, 214], source.tint, 0.25) : mix(source.tint, WHITE, 0.35 + rf() * 0.5)),
    });
  }
  const mist: Mist[] = Array.from({ length: 9 }, () => ({ r0: r() * source.R * 0.85, a0: r() * TAU, size: source.R * (0.35 + r() * 0.45), rot: r() * TAU }));
  return { dust, fine, mist };
}

/** The aurora between two linked subjects, taller and brighter the more links it carries. */
export function buildAurora(A: MapSystem, B: MapSystem, key: string, count: number, index: number): Aurora {
  const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const p0: [number, number] = [A.x + ux * A.R * 0.7, A.y + uy * A.R * 0.7];
  const p2: [number, number] = [B.x - ux * B.R * 0.7, B.y - uy * B.R * 0.7];
  const mx = (p0[0] + p2[0]) / 2, my = (p0[1] + p2[1]) / 2;
  let px = -uy, py = ux;
  if (px * mx + py * my < 0) { px = -px; py = -py; }
  // Bend around the centre rather than through it.
  const bow = d * 0.17 + Math.max(0, 300 - 2 * Math.hypot(mx, my));
  const sr = memoryMapRandom(memoryMapHash(`${key}:aurora`));
  // Grows with every link, more slowly as they pile up: 1 link ~40 tall, 4 ~80, 18 ~140.
  const g = Math.log2(1 + count);
  const first = AURORA_PALETTES[Math.floor(sr() * AURORA_PALETTES.length)];
  let second = AURORA_PALETTES[Math.floor(sr() * AURORA_PALETTES.length)];
  if (second === first) second = AURORA_PALETTES[(AURORA_PALETTES.indexOf(first) + 3) % AURORA_PALETTES.length];
  const seed = memoryMapHash(key) % 1000;
  return {
    key, A, B, count, p0, p2, p1: [mx + px * bow, my + py * bow], seed,
    palette: mixPalette(first, second, 0.5),
    rays: Array.from({ length: 7 }, (_, i) =>
      raySprite(mixPalette(first, second, i / 6), mix(A.tint, B.tint, i / 6), 0.5 + 0.5 * Math.sin(i * 1.9 + seed + index))
    ),
    layers: Math.min(3, Math.ceil(g)),
    height: 10 + 30 * g,
    glow: Math.min(1.25, 0.62 + 0.17 * g),
    thick: 0.5 + 0.25 * g,
    fold: { f1: 0.7 + sr() * 0.9, f2: 1.7 + sr() * 1.5, amp: 8 + 4 * g, speed: 0.22 + sr() * 0.2 },
    sparkles: Array.from({ length: Math.round(14 * g) }, () => ({ t: 0.06 + sr() * 0.88, h: 0.08 + sr() * 0.85, sz: sr(), ph: sr() * TAU, sp: 0.8 + sr() * 2.2 })),
  };
}
