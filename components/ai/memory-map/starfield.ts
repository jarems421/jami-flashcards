/**
 * The memory map's background stars: three depths of them, nearer ones
 * brighter, drifting with the camera at their own pace and wrapping round so
 * the sky never runs out.
 *
 * The same sky every time: the stars are drawn from a fixed seed.
 */

import { memoryMapRandom } from "@/lib/ai/memory-map";
import { TAU, lerp } from "@/components/ai/memory-map/sprites";

export type FieldStar = {
  x: number;
  y: number;
  /** Depth: how much it moves with the camera. */
  d: number;
  s: number;
  b: number;
  sp: number;
  ph: number;
  bright: boolean;
};

export function createStarField(): FieldStar[] {
  const stars: FieldStar[] = [];
  const random = memoryMapRandom(11);
  for (const layer of [{ d: 0.03, n: 260, s: [0.5, 1] }, { d: 0.12, n: 150, s: [0.6, 1.4] }, { d: 0.28, n: 70, s: [0.9, 2] }]) {
    for (let i = 0; i < layer.n; i++) {
      stars.push({
        x: random() - 0.5, y: random() - 0.5, d: layer.d, s: lerp(layer.s[0], layer.s[1], random()),
        b: 0.25 + random() * 0.75, sp: 0.4 + random() * 1.8, ph: random() * TAU, bright: layer.d > 0.2,
      });
    }
  }
  return stars;
}

/** What drawing the stars needs to know about the frame they are drawn in. */
export type StarFieldFrame = {
  width: number;
  height: number;
  centreX: number;
  centreY: number;
  camera: { x: number; y: number; z: number; r: number };
  /** The zoom at which the whole map fits. */
  universeZoom: number;
  /** Seconds of animation so far; still while motion is reduced. */
  time: number;
  reducedMotion: boolean;
  /** What a bright star is drawn with. */
  dot: HTMLCanvasElement;
};

export function drawStarField(ctx: CanvasRenderingContext2D, stars: readonly FieldStar[], frame: StarFieldFrame) {
  const { width: W, height: H, centreX: cx, centreY: cy, camera: cam, universeZoom, time: T } = frame;
  const Fw = W * 1.35, Fh = H * 1.35;
  const bc = Math.cos(cam.r * 0.5), bs = Math.sin(cam.r * 0.5);
  for (const star of stars) {
    const e = Math.pow(cam.z / universeZoom, star.d);
    let px = star.x * Fw - cam.x * universeZoom * star.d * 2.2;
    let py = star.y * Fh - cam.y * universeZoom * star.d * 2.2;
    px = ((((px + Fw / 2) % Fw) + Fw) % Fw) - Fw / 2;
    py = ((((py + Fh / 2) % Fh) + Fh) % Fh) - Fh / 2;
    const ox = px * e, oy = py * e;
    const sx = cx + ox * bc - oy * bs, sy = cy + ox * bs + oy * bc;
    if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
    const alpha = star.b * (frame.reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(T * star.sp + star.ph));
    if (star.bright) {
      ctx.globalAlpha = alpha;
      const D = star.s * 7;
      ctx.drawImage(frame.dot, sx - D / 2, sy - D / 2, D, D);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = `rgba(225,218,255,${alpha})`;
      ctx.fillRect(sx, sy, star.s, star.s);
    }
  }
}
