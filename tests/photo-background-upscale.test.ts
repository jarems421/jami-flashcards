import { describe, expect, it } from "vitest";
import {
  findFlatPalette,
  isFaithfulSharpening,
  photoBackgroundUpscaleFactor,
  sharpenFlatGraphic,
} from "@/lib/app/photo-background-upscale";

const PINK = [247, 217, 225] as const;
const BROWN = [58, 36, 33] as const;

/** RGBA pixels for a width x height image, one colour per pixel. */
function image(width: number, height: number, colourAt: (x: number, y: number) => readonly number[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colourAt(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return data;
}

/** Brown dots on pink, with a one-pixel blended edge like an anti-aliased wallpaper. */
function polkaDots(width: number, height: number) {
  return image(width, height, (x, y) => {
    const dx = (x % 38) - 19;
    const dy = (y % 38) - 19;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const inside = Math.min(1, Math.max(0, 8.5 - distance));
    return PINK.map((channel, index) => channel + (BROWN[index] - channel) * inside);
  });
}

describe("how much a background is enlarged", () => {
  it("brings a phone wallpaper up to cover a retina laptop, within the caps", () => {
    expect(photoBackgroundUpscaleFactor(736, 1177)).toBeCloseTo(2880 / 736, 2);
    expect(photoBackgroundUpscaleFactor(200, 200)).toBe(4);
  });

  it("leaves an image that is already big enough alone", () => {
    expect(photoBackgroundUpscaleFactor(2880, 4000)).toBe(1);
    expect(photoBackgroundUpscaleFactor(0, 100)).toBe(1);
  });
});

describe("telling a flat graphic from a photo", () => {
  it("finds the two colours a polka-dot wallpaper is drawn in", () => {
    const palette = findFlatPalette(polkaDots(152, 152), 152, 152);
    expect(palette).toHaveLength(2);
    const [background] = palette ?? [];
    expect(background.r).toBeGreaterThan(230);
  });

  it("does not mistake a smooth gradient for flat colour", () => {
    const gradient = image(200, 200, (x) => [30 + x, 60 + x * 0.6, 200 - x * 0.5]);
    expect(findFlatPalette(gradient, 200, 200)).toBeNull();
  });

  it("does not mistake a noisy photo for flat colour", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 255;
    const noise = image(120, 120, () => [random(), random(), random()]);
    expect(findFlatPalette(noise, 120, 120)).toBeNull();
  });
});

describe("checking a sharpened graphic is still the original", () => {
  const original = polkaDots(76, 76);

  it("accepts a result that shrinks back to the same image, noise and all", () => {
    expect(isFaithfulSharpening(original, original)).toBe(true);
    // JPEG-sized wobble everywhere is not a changed picture.
    const noisy = original.map((value, index) => (index % 4 === 3 ? value : Math.min(255, value + 8)));
    expect(isFaithfulSharpening(original, noisy)).toBe(true);
  });

  it("rejects one that erased part of the picture", () => {
    // A tenth of the image -- a subtle stripe, a gradient -- came back 30 away.
    const erased = original.slice();
    for (let pixel = 0; pixel < 76 * 76 * 0.1; pixel += 1) {
      erased[pixel * 4] = Math.max(0, erased[pixel * 4] - 30);
    }
    expect(isFaithfulSharpening(original, erased)).toBe(false);
  });
});

describe("sharpening an enlarged graphic", () => {
  it("turns a stretched, blurry edge back into a crisp one in the image's own colours", () => {
    // A hard edge enlarged 4x blurs into a ramp about four pixels wide.
    const edge = image(16, 1, (x) =>
      PINK.map((channel, index) => channel + (BROWN[index] - channel) * Math.min(1, Math.max(0, (x - 6) / 4)))
    );
    sharpenFlatGraphic(edge, [{ r: PINK[0], g: PINK[1], b: PINK[2] }, { r: BROWN[0], g: BROWN[1], b: BROWN[2] }], 4);

    const reds = Array.from({ length: 16 }, (_, x) => edge[x * 4]);
    // Pure colour on both sides, and the change squeezed into a couple of pixels.
    expect(reds.slice(0, 5).every((red) => red === PINK[0])).toBe(true);
    expect(reds.slice(11).every((red) => red === BROWN[0])).toBe(true);
    const inBetween = reds.filter((red) => red !== PINK[0] && red !== BROWN[0]);
    expect(inBetween.length).toBeLessThanOrEqual(3);
  });
});
