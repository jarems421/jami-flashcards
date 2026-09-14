import {
  photoBackgroundViewPixels,
  type PhotoBackgroundSample,
  type PhotoBackgroundScheme,
  type PhotoBackgroundVars,
  type PhotoBackgroundView,
} from "@/lib/app/photo-background";

/**
 * The app's colours, picked from a photo so everything stays readable over it.
 *
 * A photo can be anything -- a white beach, a black night sky, a busy poster --
 * and a fixed palette is unreadable over some of them. So the palette is read
 * off the photo itself:
 *
 *  - Light or dark comes from how bright the photo is overall: dark glass with
 *    light text over most photos, light glass with dark text over bright ones.
 *  - The accent is the photo's own most vivid colour, moved lighter or darker
 *    until it can be read as text and carry text of its own.
 *  - Panels are only as see-through as the photo allows. Their opacity is the
 *    lowest at which text still meets WCAG contrast over the photo's brightest
 *    (or, for light glass, darkest) area, so a calm photo shows through more
 *    and a harsh one less, and no text is ever unreadable either way.
 *
 * Everything is measured, not assumed: contrast is the WCAG ratio, and "over
 * the photo" is the colour a translucent panel actually composites to.
 */

export type Rgb = { r: number; g: number; b: number };

export type PhotoBackgroundPalette = {
  scheme: PhotoBackgroundScheme;
  vars: PhotoBackgroundVars;
};

/** Mean relative luminance at or above which the photo gets light glass. */
const LIGHT_SCHEME_MEAN_LUMINANCE = 0.45;
const MIN_TEXT_CONTRAST = 7;
const MIN_SMALL_TEXT_CONTRAST = 4.5;
/** Which share of a photo counts as its brightest or darkest area, so one stray pixel does not decide. */
const EXTREME_FRACTION = 0.02;
const HUE_BINS = 36;
/** Below this, a photo is near enough greyscale that picking a hue from it would be inventing one. */
const MIN_COLOURFULNESS = 0.06;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function channel(value: number) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** What `top` at `alpha` over `bottom` looks like, blended the way a browser blends CSS colours. */
export function compositeOver(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
  };
}

function rounded({ r, g, b }: Rgb): Rgb {
  return {
    r: Math.round(clamp(r, 0, 255)),
    g: Math.round(clamp(g, 0, 255)),
    b: Math.round(clamp(b, 0, 255)),
  };
}

function toHsl({ r, g, b }: Rgb) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const hue = (((h % 360) + 360) % 360) / 360;
  const lightness = clamp(l, 0, 1);
  const saturation = clamp(s, 0, 1);
  if (saturation === 0) {
    const value = lightness * 255;
    return rounded({ r: value, g: value, b: value });
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const convert = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return rounded({
    r: convert(hue + 1 / 3) * 255,
    g: convert(hue) * 255,
    b: convert(hue - 1 / 3) * 255,
  });
}

function hex({ r, g, b }: Rgb) {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function triplet({ r, g, b }: Rgb) {
  return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
}

/**
 * The hue a photo is mostly made of, weighted towards vivid pixels.
 *
 * Near-black and near-white pixels carry no real hue, so a pixel counts for
 * its saturation and for how far it sits from either end. Neighbouring bins
 * share weight so a colour straddling two bins is not undercounted.
 */
function dominantColour(colours: Rgb[]) {
  const weights = new Array<number>(HUE_BINS).fill(0);
  const sums = Array.from({ length: HUE_BINS }, () => ({ r: 0, g: 0, b: 0 }));
  for (const colour of colours) {
    const { h, s, l } = toHsl(colour);
    const vividness = s * Math.max(0, 1 - Math.abs(l - 0.5) * 2);
    if (vividness <= 0.05) continue;
    const bin = Math.floor((h / 360) * HUE_BINS) % HUE_BINS;
    weights[bin] += vividness;
    sums[bin].r += colour.r * vividness;
    sums[bin].g += colour.g * vividness;
    sums[bin].b += colour.b * vividness;
  }

  let best = { weight: 0, r: 0, g: 0, b: 0 };
  for (let bin = 0; bin < HUE_BINS; bin += 1) {
    const around = [(bin + HUE_BINS - 1) % HUE_BINS, bin, (bin + 1) % HUE_BINS];
    const share = [0.5, 1, 0.5];
    const combined = around.reduce(
      (total, index, position) => ({
        weight: total.weight + weights[index] * share[position],
        r: total.r + sums[index].r * share[position],
        g: total.g + sums[index].g * share[position],
        b: total.b + sums[index].b * share[position],
      }),
      { weight: 0, r: 0, g: 0, b: 0 }
    );
    if (combined.weight > best.weight) best = combined;
  }

  const colourful = colours.length > 0 && best.weight / colours.length >= MIN_COLOURFULNESS;
  return colourful
    ? { colourful, hsl: toHsl({ r: best.r / best.weight, g: best.g / best.weight, b: best.b / best.weight }) }
    : { colourful, hsl: { h: 230, s: 0, l: 0.5 } };
}

/** The palette for whatever part of the photo this view can put on screen. */
export function derivePhotoBackgroundPaletteForView(
  sample: PhotoBackgroundSample,
  view: PhotoBackgroundView
): PhotoBackgroundPalette {
  return derivePhotoBackgroundPalette(photoBackgroundViewPixels(sample, view));
}

/** Takes RGBA pixel data, as `getImageData` returns it, from a small copy of the photo. */
export function derivePhotoBackgroundPalette(pixels: ArrayLike<number>): PhotoBackgroundPalette {
  const samples: Array<{ colour: Rgb; luminance: number }> = [];
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const colour = { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] };
    samples.push({ colour, luminance: relativeLuminance(colour) });
  }
  if (samples.length === 0) {
    const fallback = { r: 20, g: 24, b: 40 };
    samples.push({ colour: fallback, luminance: relativeLuminance(fallback) });
  }
  samples.sort((left, right) => left.luminance - right.luminance);

  const mean = samples.reduce((total, sample) => total + sample.luminance, 0) / samples.length;
  const scheme: PhotoBackgroundScheme = mean >= LIGHT_SCHEME_MEAN_LUMINANCE ? "light" : "dark";
  const dark = scheme === "dark";
  const at = (fraction: number) =>
    samples[clamp(Math.round((samples.length - 1) * fraction), 0, samples.length - 1)].colour;
  // The part of the photo text has the hardest time against.
  const hardest = dark ? at(1 - EXTREME_FRACTION) : at(EXTREME_FRACTION);

  const { colourful, hsl } = dominantColour(samples.map((sample) => sample.colour));
  const hue = hsl.h;
  const tint = colourful ? Math.min(hsl.s, 0.6) : 0;

  const surface = fromHsl(hue, tint * 0.45, dark ? 0.085 : 0.975);
  const solid = fromHsl(hue, tint * 0.4, dark ? 0.075 : 0.985);
  const solidAlt = fromHsl(hue, tint * 0.45, dark ? 0.11 : 0.955);
  const base = fromHsl(hue, tint * 0.4, dark ? 0.05 : 0.93);
  const text = fromHsl(hue, tint * 0.3, dark ? 0.97 : 0.1);
  const textSecondary = fromHsl(hue, tint * 0.3, dark ? 0.9 : 0.19);
  const textMuted = fromHsl(hue, tint * 0.25, dark ? 0.8 : 0.32);

  // A tint over the photo itself, stronger the more the photo fights the glass.
  const overlayAlpha = dark
    ? clamp((mean - 0.04) * 1.2, 0.12, 0.55)
    : clamp((0.85 - mean) * 0.8, 0.1, 0.4);
  const overlayColour = dark ? base : surface;
  const behindPanels = rounded(compositeOver(overlayColour, overlayAlpha, hardest));

  // From half-transparent upwards: a calm photo shows through, a harsh one does not.
  let panelAlpha = 0.94;
  for (let step = 50; step <= 94; step += 1) {
    const alpha = step / 100;
    const seen = rounded(compositeOver(surface, alpha, behindPanels));
    if (
      contrastRatio(text, seen) >= MIN_TEXT_CONTRAST &&
      contrastRatio(textMuted, seen) >= MIN_SMALL_TEXT_CONTRAST
    ) {
      panelAlpha = alpha;
      break;
    }
  }
  const strongAlpha = Math.min(0.97, panelAlpha + 0.1);
  const panelSeen = rounded(compositeOver(surface, panelAlpha, behindPanels));

  const onAccent = dark ? fromHsl(hue, 0.35, 0.08) : { r: 255, g: 255, b: 255 };
  const accentSaturation = colourful ? clamp(hsl.s, 0.45, 0.85) : 0.1;
  const accentAt = (lightness: number) => fromHsl(hue, accentSaturation, lightness);
  const readableAccent = (colour: Rgb) =>
    [panelSeen, solid].every((background) => contrastRatio(colour, background) >= MIN_SMALL_TEXT_CONTRAST) &&
    contrastRatio(onAccent, colour) >= MIN_SMALL_TEXT_CONTRAST;
  let accentLightness = dark ? 0.62 : 0.42;
  for (let attempt = 0; attempt < 30 && !readableAccent(accentAt(accentLightness)); attempt += 1) {
    accentLightness = clamp(accentLightness + (dark ? 0.02 : -0.02), 0, 1);
  }
  const accent = accentAt(accentLightness);
  const accentHover = accentAt(clamp(accentLightness + (dark ? 0.08 : -0.07), 0, 1));

  const line = dark ? { r: 255, g: 255, b: 255 } : fromHsl(hue, tint * 0.3, 0.15);
  const shadow = dark ? { r: 0, g: 0, b: 0 } : fromHsl(hue, tint * 0.3, 0.18);
  const overlay = rounded(overlayColour);

  return {
    scheme,
    vars: {
      "--photo-base": hex(base),
      "--photo-surface-rgb": triplet(surface),
      "--photo-panel-alpha": panelAlpha.toFixed(2),
      "--photo-panel-strong-alpha": strongAlpha.toFixed(2),
      "--photo-solid": hex(solid),
      "--photo-solid-alt": hex(solidAlt),
      "--photo-text": hex(text),
      "--photo-text-secondary": hex(textSecondary),
      "--photo-text-muted": hex(textMuted),
      "--photo-line-rgb": triplet(line),
      "--photo-shadow-rgb": triplet(shadow),
      "--photo-accent": hex(accent),
      "--photo-accent-hover": hex(accentHover),
      "--photo-accent-rgb": triplet(accent),
      "--photo-on-accent": hex(onAccent),
      "--photo-overlay": `rgba(${overlay.r}, ${overlay.g}, ${overlay.b}, ${overlayAlpha.toFixed(2)})`,
    },
  };
}
