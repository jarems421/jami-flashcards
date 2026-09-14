import { describe, expect, it } from "vitest";
import {
  compositeOver,
  contrastRatio,
  derivePhotoBackgroundPalette,
  type Rgb,
} from "@/lib/app/photo-background-palette";
import {
  PHOTO_BACKGROUND_VALUE_PATTERN,
  PHOTO_BACKGROUND_VAR_NAMES,
} from "@/lib/app/photo-background";

/** RGBA pixel data for an image made of these colours, in equal shares. */
function image(...colours: Rgb[]) {
  const pixels: number[] = [];
  for (let index = 0; index < 64 * 64; index += 1) {
    const colour = colours[index % colours.length];
    pixels.push(colour.r, colour.g, colour.b, 255);
  }
  return pixels;
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

function hexColour(value: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  expect(match, value).not.toBeNull();
  return { r: parseInt(match![1], 16), g: parseInt(match![2], 16), b: parseInt(match![3], 16) };
}

function tripletColour(value: string): Rgb {
  const [r, g, b] = value.split(" ").map(Number);
  return { r, g, b };
}

function overlay(value: string) {
  const match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value);
  expect(match, value).not.toBeNull();
  return {
    colour: { r: Number(match![1]), g: Number(match![2]), b: Number(match![3]) },
    alpha: Number(match![4]),
  };
}

/** What a panel's text actually sits on, over one colour of the photo. */
function panelOver(vars: Record<string, string>, photoColour: Rgb) {
  const scrim = overlay(vars["--photo-overlay"]);
  const behind = compositeOver(scrim.colour, scrim.alpha, photoColour);
  return compositeOver(tripletColour(vars["--photo-surface-rgb"]), Number(vars["--photo-panel-alpha"]), behind);
}

function expectReadableOver(vars: Record<string, string>, photoColours: Rgb[]) {
  for (const colour of photoColours) {
    const seen = panelOver(vars, colour);
    expect(contrastRatio(hexColour(vars["--photo-text"]), seen)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(hexColour(vars["--photo-text-muted"]), seen)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hexColour(vars["--photo-accent"]), seen)).toBeGreaterThanOrEqual(4.5);
  }
  const solid = hexColour(vars["--photo-solid"]);
  expect(contrastRatio(hexColour(vars["--photo-text"]), solid)).toBeGreaterThanOrEqual(7);
  expect(contrastRatio(hexColour(vars["--photo-accent"]), solid)).toBeGreaterThanOrEqual(4.5);
  expect(
    contrastRatio(hexColour(vars["--photo-on-accent"]), hexColour(vars["--photo-accent"]))
  ).toBeGreaterThanOrEqual(4.5);
}

describe("picking colours from a photo", () => {
  it("gives a bright photo light glass with dark text", () => {
    const palette = derivePhotoBackgroundPalette(image({ r: 240, g: 244, b: 250 }));
    expect(palette.scheme).toBe("light");
    expectReadableOver(palette.vars, [{ r: 240, g: 244, b: 250 }]);
  });

  it("gives a dark photo dark glass with light text", () => {
    const palette = derivePhotoBackgroundPalette(image({ r: 12, g: 18, b: 40 }));
    expect(palette.scheme).toBe("dark");
    expectReadableOver(palette.vars, [{ r: 12, g: 18, b: 40 }]);
  });

  it("keeps text readable over both the brightest and darkest parts of a harsh photo", () => {
    for (const photo of [image(WHITE, BLACK), image(WHITE, BLACK, BLACK, BLACK), image(WHITE, WHITE, WHITE, BLACK)]) {
      expectReadableOver(derivePhotoBackgroundPalette(photo).vars, [WHITE, BLACK]);
    }
  });

  it("lets a calm photo show through more than a harsh one", () => {
    const calm = derivePhotoBackgroundPalette(image({ r: 20, g: 30, b: 60 }));
    const harsh = derivePhotoBackgroundPalette(image({ r: 20, g: 30, b: 60 }, WHITE, { r: 20, g: 30, b: 60 }));
    expect(Number(calm.vars["--photo-panel-alpha"])).toBeLessThan(Number(harsh.vars["--photo-panel-alpha"]));
  });

  it("takes the accent from the photo's own colour", () => {
    const red = hexColour(derivePhotoBackgroundPalette(image({ r: 170, g: 20, b: 30 })).vars["--photo-accent"]);
    expect(red.r).toBeGreaterThan(red.g + 40);
    expect(red.r).toBeGreaterThan(red.b + 40);

    const green = hexColour(derivePhotoBackgroundPalette(image({ r: 20, g: 140, b: 60 })).vars["--photo-accent"]);
    expect(green.g).toBeGreaterThan(green.r + 40);
  });

  it("does not invent a hue for a greyscale photo", () => {
    const accent = hexColour(derivePhotoBackgroundPalette(image({ r: 90, g: 90, b: 90 }, { r: 30, g: 30, b: 30 })).vars["--photo-accent"]);
    expect(Math.max(accent.r, accent.g, accent.b) - Math.min(accent.r, accent.g, accent.b)).toBeLessThan(40);
  });

  it("produces every value, each safe to put in a stylesheet, even from an empty image", () => {
    for (const pixels of [image(WHITE), [], [0, 0, 0, 0]]) {
      const { vars } = derivePhotoBackgroundPalette(pixels);
      for (const name of PHOTO_BACKGROUND_VAR_NAMES) {
        expect(vars[name], name).toMatch(PHOTO_BACKGROUND_VALUE_PATTERN);
      }
    }
  });
});
