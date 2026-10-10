import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Page } from "@playwright/test";

/*
 * Screenshots of the stage, compared pixel by pixel. Screenshots rather than
 * canvas reads, because what counts is what the screen shows: tiles, live ink
 * and the white page composited together.
 */

export type Pixels = { data: Buffer; width: number; height: number };

export type View = { width: number; height: number };

/** The stage (at the top-left of the page) in device pixels. */
export async function capture(page: Page, view: View): Promise<Pixels> {
  const png = await page.screenshot({
    clip: { x: 0, y: 0, width: view.width, height: view.height },
    animations: "disabled",
    caret: "hide",
    scale: "device",
  });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export type PixelDiff = {
  width: number;
  height: number;
  /** Pixels that differ at all. */
  changed: number;
  /** Pixels whose largest channel difference is over the tolerance. */
  overTolerance: number;
  /** The largest channel difference anywhere, 0 to 255. */
  maxDifference: number;
  /** Pixels with any ink in either image (not white), for scale. */
  inked: number;
  /** The most pixels over the tolerance that touch one another (8-connected). */
  largestCluster: number;
};

const WHITE = 255;

/** The size of the largest 8-connected group of set cells in a mask. */
function largestCluster(mask: Uint8Array, width: number, height: number): number {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  let largest = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let size = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const at = stack.pop()!;
      size += 1;
      const x = at % width;
      const y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

export function diffPixels(a: Pixels, b: Pixels, tolerance: number): PixelDiff {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Screenshots differ in size: ${a.width}x${a.height} and ${b.width}x${b.height}`);
  }
  let changed = 0;
  let overTolerance = 0;
  let maxDifference = 0;
  let inked = 0;
  const over = new Uint8Array(a.width * a.height);
  for (let i = 0; i < a.data.length; i += 4) {
    let difference = 0;
    let ink = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const left = a.data[i + channel];
      const right = b.data[i + channel];
      difference = Math.max(difference, Math.abs(left - right));
      if (left !== WHITE || right !== WHITE) ink = true;
    }
    if (ink) inked += 1;
    if (difference > 0) changed += 1;
    if (difference > tolerance) {
      overTolerance += 1;
      over[i / 4] = 1;
    }
    if (difference > maxDifference) maxDifference = difference;
  }
  return {
    width: a.width,
    height: a.height,
    changed,
    overTolerance,
    maxDifference,
    inked,
    largestCluster: overTolerance > 0 ? largestCluster(over, a.width, a.height) : 0,
  };
}

/**
 * Writes the pair and a difference map (each changed pixel red, brighter for a
 * larger difference) under test-results, for looking at a failure.
 */
export async function saveDiff(name: string, a: Pixels, b: Pixels): Promise<string> {
  const directory = path.resolve(process.cwd(), "test-results", "ink-engine");
  fs.mkdirSync(directory, { recursive: true });
  const map = Buffer.alloc(a.data.length);
  for (let i = 0; i < a.data.length; i += 4) {
    let difference = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      difference = Math.max(difference, Math.abs(a.data[i + channel] - b.data[i + channel]));
    }
    const grey = Math.round((a.data[i] + a.data[i + 1] + a.data[i + 2]) / 12) + 170;
    map[i] = difference > 0 ? 255 : grey;
    map[i + 1] = difference > 0 ? Math.max(0, 200 - difference * 4) : grey;
    map[i + 2] = difference > 0 ? Math.max(0, 200 - difference * 4) : grey;
    map[i + 3] = 255;
  }
  const raw = { width: a.width, height: a.height, channels: 4 as const };
  const base = path.join(directory, name.replace(/[^a-z0-9-]+/gi, "-"));
  await sharp(a.data, { raw }).png().toFile(`${base}-a.png`);
  await sharp(b.data, { raw }).png().toFile(`${base}-b.png`);
  await sharp(map, { raw }).png().toFile(`${base}-diff.png`);
  return base;
}
