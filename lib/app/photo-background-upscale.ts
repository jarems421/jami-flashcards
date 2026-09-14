import type { Rgb } from "@/lib/app/photo-background-palette";

/**
 * Enlarging a background that is smaller than the screen it covers.
 *
 * A photo cannot be given detail it does not have, so photos are left as they
 * are. A flat graphic can: a polka-dot or striped wallpaper, a simple
 * illustration, anything drawn in a handful of solid colours. Its edges are
 * only blurry because they were stretched, and after enlarging they can be
 * pulled back to the image's own colours -- which is what a sharper original
 * would have looked like.
 */

/** The shorter edge a cover-sized background needs for a retina laptop or iPad. */
export const UPSCALE_TARGET_SHORT_EDGE = 2880;
export const MAX_UPSCALE_FACTOR = 4;
const MAX_UPSCALED_EDGE = 5120;
/** Under iPad Safari's canvas limit, with room to spare. */
const MAX_UPSCALED_PIXELS = 16_000_000;

/** How much to enlarge a graphic of this size, or 1 when it is already big enough. */
export function photoBackgroundUpscaleFactor(width: number, height: number) {
  if (width <= 0 || height <= 0) return 1;
  const factor = Math.min(
    MAX_UPSCALE_FACTOR,
    UPSCALE_TARGET_SHORT_EDGE / Math.min(width, height),
    MAX_UPSCALED_EDGE / Math.max(width, height),
    Math.sqrt(MAX_UPSCALED_PIXELS / (width * height))
  );
  return factor > 1.05 ? factor : 1;
}

const MAX_FLAT_COLOURS = 6;
/** Palette colours closer than this are one colour with compression noise in it. */
const MIN_COLOUR_SEPARATION = 80;
/** How far a pixel can sit from its colour and still count as that colour. */
const COVER_RADIUS = 32;
/**
 * Share of the image that must sit on a palette colour. The rest is edges.
 *
 * A smooth gradient cannot pass this: with colours at least 80 apart and a
 * radius of 32, at most four fifths of a gradient lies near any of them.
 */
const MIN_FLAT_COVERAGE = 0.88;
const MIN_BIN_SHARE = 0.005;

function distanceSquared(a: Rgb, b: Rgb) {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

/**
 * The solid colours an image is drawn in, or null for a photo.
 *
 * Reads every other pixel each way, which is plenty to tell the two apart and
 * keeps a large photo quick.
 */
export function findFlatPalette(
  data: ArrayLike<number>,
  width: number,
  height: number
): Rgb[] | null {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 128) continue;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bin.count += 1;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bins.set(key, bin);
      total += 1;
    }
  }
  if (total === 0) return null;

  const palette: Rgb[] = [];
  const sorted = [...bins.values()].sort((left, right) => right.count - left.count);
  for (const bin of sorted) {
    if (bin.count < total * MIN_BIN_SHARE) break;
    const colour = { r: bin.r / bin.count, g: bin.g / bin.count, b: bin.b / bin.count };
    if (palette.every((existing) => distanceSquared(existing, colour) >= MIN_COLOUR_SEPARATION ** 2)) {
      palette.push(colour);
      if (palette.length > MAX_FLAT_COLOURS) return null;
    }
  }
  if (palette.length < 2) return null;

  let covered = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 128) continue;
      const pixel = { r: data[index], g: data[index + 1], b: data[index + 2] };
      if (palette.some((colour) => distanceSquared(colour, pixel) <= COVER_RADIUS ** 2)) covered += 1;
    }
  }
  return covered / total >= MIN_FLAT_COVERAGE ? palette : null;
}

/** A colour that moves further than this has visibly changed, beyond JPEG noise. */
const UNFAITHFUL_DISTANCE = 24;
/** More changed pixels than this share and the sharpening altered the picture itself. */
const MAX_UNFAITHFUL_SHARE = 0.05;

/**
 * Whether a sharpened graphic, shrunk back to its original size, is still the
 * original image.
 *
 * Crisp edges shrink back into the soft edges that were there, so a faithful
 * sharpening comes back almost unchanged. What does not come back is what the
 * palette got wrong: a subtle second shade flattened into the first, or a
 * gradient cut into bands. When too much of the picture differs, the graphic
 * is treated as a photo instead.
 */
export function isFaithfulSharpening(original: ArrayLike<number>, roundTrip: ArrayLike<number>) {
  let total = 0;
  let changed = 0;
  for (let index = 0; index + 3 < original.length; index += 4) {
    if (original[index + 3] < 128) continue;
    total += 1;
    const distance =
      (original[index] - roundTrip[index]) ** 2 +
      (original[index + 1] - roundTrip[index + 1]) ** 2 +
      (original[index + 2] - roundTrip[index + 2]) ** 2;
    if (distance > UNFAITHFUL_DISTANCE ** 2) changed += 1;
  }
  return total === 0 || changed / total <= MAX_UNFAITHFUL_SHARE;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Pulls an enlarged graphic's blurred edges back to its own colours, in place.
 *
 * Each pixel is placed between the two palette colours it sits between, and
 * that position is steepened so the change from one colour to the next takes
 * about a pixel and a half -- crisp, but still smooth rather than jagged.
 */
export function sharpenFlatGraphic(data: Uint8ClampedArray, palette: Rgb[], factor: number) {
  const halfWidth = Math.min(0.5, 0.75 / Math.max(1, factor));
  for (let index = 0; index + 3 < data.length; index += 4) {
    const pixel = { r: data[index], g: data[index + 1], b: data[index + 2] };
    let nearest = 0;
    let second = 1;
    let nearestDistance = Infinity;
    let secondDistance = Infinity;
    for (let colour = 0; colour < palette.length; colour += 1) {
      const distance = distanceSquared(palette[colour], pixel);
      if (distance < nearestDistance) {
        second = nearest;
        secondDistance = nearestDistance;
        nearest = colour;
        nearestDistance = distance;
      } else if (distance < secondDistance) {
        second = colour;
        secondDistance = distance;
      }
    }
    const a = palette[nearest];
    const b = palette[second];
    const ab = { r: b.r - a.r, g: b.g - a.g, b: b.b - a.b };
    const length = ab.r ** 2 + ab.g ** 2 + ab.b ** 2;
    const along =
      length > 0
        ? ((pixel.r - a.r) * ab.r + (pixel.g - a.g) * ab.g + (pixel.b - a.b) * ab.b) / length
        : 0;
    const blend = smoothstep(0.5 - halfWidth, 0.5 + halfWidth, Math.min(1, Math.max(0, along)));
    data[index] = a.r + ab.r * blend;
    data[index + 1] = a.g + ab.g * blend;
    data[index + 2] = a.b + ab.b * blend;
  }
}
