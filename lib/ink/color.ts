import type { InkColor } from "@/lib/ink/model";

/** The few CSS names js-draw or Jami's own SVG could plausibly write. */
const NAMED_COLORS: ReadonlyMap<string, readonly [number, number, number]> = new Map([
  ["black", [0, 0, 0]],
  ["white", [255, 255, 255]],
  ["red", [255, 0, 0]],
  ["green", [0, 128, 0]],
  ["blue", [0, 0, 255]],
  ["yellow", [255, 255, 0]],
  ["orange", [255, 165, 0]],
  ["purple", [128, 0, 128]],
  ["pink", [255, 192, 203]],
  ["cyan", [0, 255, 255]],
  ["magenta", [255, 0, 255]],
  ["gray", [128, 128, 128]],
  ["grey", [128, 128, 128]],
]);

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampAlpha(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Reads hex digits. 3 and 4 digit forms follow CSS (`#abc` is `#aabbcc`), but
 * js-draw's `Color4.fromHex` differs and reads `#abc` as `#a0b0c0`. Pages it
 * wrote never use the short form, and Jami writes only 6 or 8 digits (see
 * `formatInkColor`), so both readers agree on everything saved.
 */
function parseHex(digits: string): InkColor | null {
  if (!/^[0-9a-f]+$/.test(digits)) return null;
  const length = digits.length;
  if (length !== 3 && length !== 4 && length !== 6 && length !== 8) return null;
  const short = length <= 4;
  const channel = (index: number) =>
    short
      ? parseInt(digits[index] + digits[index], 16)
      : parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  const hasAlpha = length === 4 || length === 8;
  return { r: channel(0), g: channel(1), b: channel(2), a: hasAlpha ? channel(3) / 255 : 1 };
}

/** A number, or a percentage of `scale`. Null when it is neither. */
function parseNumberOrPercent(token: string, scale: number): number | null {
  const percent = token.endsWith("%");
  const text = percent ? token.slice(0, -1) : token;
  const value = Number(text);
  if (text === "" || !Number.isFinite(value)) return null;
  return percent ? (value / 100) * scale : value;
}

function parseRgbFunction(args: string): InkColor | null {
  const tokens = args.trim().split(/[\s,/]+/).filter((token) => token !== "");
  if (tokens.length !== 3 && tokens.length !== 4) return null;
  const r = parseNumberOrPercent(tokens[0], 255);
  const g = parseNumberOrPercent(tokens[1], 255);
  const b = parseNumberOrPercent(tokens[2], 255);
  const a = tokens.length === 4 ? parseNumberOrPercent(tokens[3], 1) : 1;
  if (r === null || g === null || b === null || a === null) return null;
  return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b), a: clampAlpha(a) };
}

/**
 * Reads a CSS colour. `none` and anything unreadable both give null, because
 * an SVG paint it cannot read is safest treated as no paint.
 */
export function parseInkColor(css: string): InkColor | null {
  const text = css.trim().toLowerCase();
  if (text === "" || text === "none") return null;
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (text.startsWith("#")) return parseHex(text.slice(1));
  const functional = /^rgba?\(([^()]*)\)$/.exec(text);
  if (functional) return parseRgbFunction(functional[1]);
  const named = NAMED_COLORS.get(text);
  return named ? { r: named[0], g: named[1], b: named[2], a: 1 } : null;
}

function hex2(value: number): string {
  return clampChannel(value).toString(16).padStart(2, "0");
}

/** `#rrggbb` when opaque, otherwise `#rrggbbaa`. */
export function formatInkColor(color: InkColor): string {
  const base = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
  return color.a >= 1 ? base : `${base}${hex2(color.a * 255)}`;
}

/** Alpha is compared at the 8-bit resolution it is stored and exported at. */
export function inkColorsEqual(a: InkColor, b: InkColor): boolean {
  return (
    a.r === b.r && a.g === b.g && a.b === b.b && Math.round(a.a * 255) === Math.round(b.a * 255)
  );
}
