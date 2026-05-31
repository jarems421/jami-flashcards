import { describe, expect, it } from "vitest";

type Rgb = { r: number; g: number; b: number };

const themes = {
  normal: {
    panel: "#111521",
    panelStrong: "#0f1320",
    fieldBg: "#0a0e18",
    chipBg: "#202635",
    selectedBg: "#3a336b",
    textPrimary: "#fff8ff",
    textSecondary: "#f1f5ff",
    textMuted: "#c8d1e3",
    fieldText: "#fff8ff",
    chipText: "#f1f5ff",
    selectedText: "#fff8ff",
    buttonPrimaryBg: "#7565d6",
    buttonPrimaryText: "#ffffff",
  },
  purple: {
    panel: "#1c0f2a",
    panelStrong: "#130a1f",
    fieldBg: "#0e0718",
    chipBg: "#271a3a",
    selectedBg: "#4b3f78",
    textPrimary: "#fff9ff",
    textSecondary: "#f8f2ff",
    textMuted: "#d4c6e7",
    fieldText: "#fff9ff",
    chipText: "#f8f2ff",
    selectedText: "#fff9ff",
    buttonPrimaryBg: "#7562d9",
    buttonPrimaryText: "#ffffff",
  },
  paperWhite: {
    panel: "#ffffff",
    panelStrong: "#ffffff",
    fieldBg: "#ffffff",
    chipBg: "#eceef2",
    selectedBg: "#e6e1fb",
    textPrimary: "#101827",
    textSecondary: "#202a3a",
    textMuted: "#465468",
    fieldText: "#101827",
    chipText: "#202a3a",
    selectedText: "#101827",
    buttonPrimaryBg: "#5f51bb",
    buttonPrimaryText: "#ffffff",
  },
  softGrey: {
    panel: "#232323",
    panelStrong: "#191919",
    fieldBg: "#0e0e0e",
    chipBg: "#343434",
    selectedBg: "#414141",
    textPrimary: "#fafafa",
    textSecondary: "#eeeeee",
    textMuted: "#c7c7c7",
    fieldText: "#fafafa",
    chipText: "#eeeeee",
    selectedText: "#fafafa",
    buttonPrimaryBg: "#d4d4d4",
    buttonPrimaryText: "#101010",
  },
  constellation: {
    panel: "#0c0918",
    panelStrong: "#080612",
    fieldBg: "#070511",
    chipBg: "#211d2f",
    selectedBg: "#372f4e",
    textPrimary: "#fffaff",
    textSecondary: "#f2edfb",
    textMuted: "#d0c8dd",
    fieldText: "#fffaff",
    chipText: "#f2edfb",
    selectedText: "#fffaff",
    buttonPrimaryBg: "#7565d6",
    buttonPrimaryText: "#ffffff",
  },
};

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function luminance({ r, g, b }: Rgb) {
  const convert = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const [red, green, blue] = [convert(r), convert(g), convert(b)];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string) {
  const front = luminance(hexToRgb(foreground));
  const back = luminance(hexToRgb(background));
  const lighter = Math.max(front, back);
  const darker = Math.min(front, back);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("theme contrast pairs", () => {
  it.each(Object.entries(themes))("%s theme keeps core text readable", (_name, theme) => {
    expect(contrast(theme.textPrimary, theme.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.textSecondary, theme.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.textMuted, theme.panelStrong)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.fieldText, theme.fieldBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.chipText, theme.chipBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.selectedText, theme.selectedBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.buttonPrimaryText, theme.buttonPrimaryBg)).toBeGreaterThanOrEqual(4.5);
  });
});
