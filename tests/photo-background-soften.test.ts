import { describe, expect, it } from "vitest";
import {
  photoSoftenSigma,
  reduceCompressionArtifacts,
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
    // A mid grey with JPEG-like wobble of a few levels.
    const noisy = greyImage(12, 12, (x, y) => 128 + (((x * 7 + y * 13) % 9) - 4));
    const before = Array.from({ length: 144 }, (_, pixel) => noisy[pixel * 4]);
    reduceCompressionArtifacts(noisy, 12, 12);
    const after = Array.from({ length: 144 }, (_, pixel) => noisy[pixel * 4]);
    expect(spread(after)).toBeLessThan(spread(before) / 2);
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

describe("softening a small photo", () => {
  it("scales with how far the photo will be stretched, within gentle bounds", () => {
    expect(photoSoftenSigma(1.6)).toBe(0.4);
    expect(photoSoftenSigma(3.2)).toBeCloseTo(0.8, 5);
    expect(photoSoftenSigma(10)).toBe(1);
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
    expect(isEnlargedPhotoBackground("users/a/appBackgrounds/f1/background-enlarged.webp")).toBe(true);
    expect(isSoftPhotoBackground("users/a/appBackgrounds/f1/background-enlarged.webp")).toBe(false);
    expect(isEnlargedPhotoBackground("users/a/appBackgrounds/f1/background-sharp.png")).toBe(false);
    expect(isSoftPhotoBackground("users/a/appBackgrounds/f1/background.jpg")).toBe(true);
  });
});
