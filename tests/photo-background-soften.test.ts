import { describe, expect, it } from "vitest";
import {
  enlargedPhotoSharpening,
  reduceCompressionArtifacts,
  sharpenPhoto,
  softenPhoto,
} from "@/lib/app/photo-background-soften";
import {
  isEnlargedPhotoBackground,
  isSoftPhotoBackground,
} from "@/lib/app/photo-background";

function greyImage(width: number, height: number, valueAt: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = valueAt(x, y);
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return data;
}

function spread(values: number[]) {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
}

describe("cleaning up compression before a photo is enlarged", () => {
  it("smooths speckle out of a flat area", () => {
    // A mid grey with JPEG-like wobble of a couple of levels.
    const noisy = greyImage(12, 12, (x, y) => 128 + (((x * 7 + y * 13) % 5) - 2));
    const before = Array.from({ length: 144 }, (_, pixel) => noisy[pixel * 4]);
    reduceCompressionArtifacts(noisy, 12, 12);
    const after = Array.from({ length: 144 }, (_, pixel) => noisy[pixel * 4]);
    expect(spread(after)).toBeLessThan(spread(before) / 2);
  });

  it("keeps fine texture like leaves and grass", () => {
    const texture = greyImage(12, 12, (x, y) => ((x + y) % 2 === 0 ? 100 : 130));
    const before = texture.slice();
    reduceCompressionArtifacts(texture, 12, 12);
    expect(Array.from(texture)).toEqual(Array.from(before));
  });

  it("leaves a real edge where it is", () => {
    const edge = greyImage(10, 4, (x) => (x < 5 ? 30 : 220));
    reduceCompressionArtifacts(edge, 10, 4);
    for (let y = 0; y < 4; y += 1) {
      expect(edge[(y * 10 + 4) * 4]).toBe(30);
      expect(edge[(y * 10 + 5) * 4]).toBe(220);
    }
  });
});

describe("sharpening an enlarged photo", () => {
  it("widens the mask with how far the photo was stretched, within bounds", () => {
    expect(enlargedPhotoSharpening(1.2).sigma).toBe(0.8);
    expect(enlargedPhotoSharpening(3.5).sigma).toBeCloseTo(1.4, 5);
    expect(enlargedPhotoSharpening(10).sigma).toBe(2);
  });

  it("steepens a soft edge and leaves flat areas alone", () => {
    const ramp = [40, 40, 40, 40, 100, 160, 160, 160, 160];
    const edge = greyImage(9, 5, (x) => ramp[x]);
    sharpenPhoto(edge, 9, 5, { sigma: 1, amount: 0.8, threshold: 3 });
    const row = (x: number) => edge[(2 * 9 + x) * 4];
    expect(row(0)).toBe(40);
    expect(row(8)).toBe(160);
    expect(row(3)).toBeLessThan(40);
    expect(row(5)).toBeGreaterThan(160);
  });

  it("spreads a hard point without changing a flat area's colour", () => {
    const flat = greyImage(6, 6, () => 90);
    softenPhoto(flat, 6, 6, 0.8);
    expect(Array.from({ length: 36 }, (_, pixel) => flat[pixel * 4]).every((value) => value === 90)).toBe(true);

    const point = greyImage(7, 7, (x, y) => (x === 3 && y === 3 ? 255 : 0));
    softenPhoto(point, 7, 7, 0.8);
    expect(point[(3 * 7 + 3) * 4]).toBeLessThan(255);
    expect(point[(3 * 7 + 4) * 4]).toBeGreaterThan(0);
    expect(point[(0 * 7 + 0) * 4]).toBe(0);
  });
});

describe("naming a background by how it was prepared", () => {
  it("tells an enlarged photo from a sharp upload and from one saved before either", () => {
    expect(isEnlargedPhotoBackground("users/a/appBackgrounds/f1/background-upscaled.webp")).toBe(true);
    expect(isSoftPhotoBackground("users/a/appBackgrounds/f1/background-upscaled.webp")).toBe(false);
    // Enlarged by the old pipeline, which blurred it first: asked for again.
    expect(isEnlargedPhotoBackground("users/a/appBackgrounds/f1/background-enlarged.webp")).toBe(false);
    expect(isSoftPhotoBackground("users/a/appBackgrounds/f1/background-enlarged.webp")).toBe(true);
    expect(isEnlargedPhotoBackground("users/a/appBackgrounds/f1/background-sharp.png")).toBe(false);
    expect(isSoftPhotoBackground("users/a/appBackgrounds/f1/background.jpg")).toBe(true);
  });
});
