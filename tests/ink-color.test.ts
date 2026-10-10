import { describe, expect, it } from "vitest";
import { formatInkColor, inkColorsEqual, parseInkColor } from "@/lib/ink/color";

describe("ink colour", () => {
  it("parses hex forms", () => {
    expect(parseInkColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseInkColor("#f008")).toEqual({ r: 255, g: 0, b: 0, a: 0x88 / 255 });
    expect(parseInkColor("#1a2B3c")).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c, a: 1 });
    expect(parseInkColor("#1a2b3c80")).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c, a: 0x80 / 255 });
  });

  it("parses rgb() and rgba() in comma and space syntax", () => {
    expect(parseInkColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseInkColor("rgba(10,20,30,0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseInkColor("rgb(10 20 30 / 50%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseInkColor("RGB(100%, 0%, 50%)")).toEqual({ r: 255, g: 0, b: 128, a: 1 });
    expect(parseInkColor("rgb(300, -4, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("parses names, transparent and none", () => {
    for (const name of ["black", "white", "red", "green", "blue", "yellow"]) {
      expect(parseInkColor(name)).not.toBeNull();
    }
    expect(parseInkColor(" Green ")).toEqual({ r: 0, g: 128, b: 0, a: 1 });
    expect(parseInkColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseInkColor("none")).toBeNull();
  });

  it("does not mistake Object.prototype names for colours", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(parseInkColor(name)).toBeNull();
    }
  });

  it("returns null for anything unreadable", () => {
    for (const bad of ["", "#12", "#12345", "#ggg", "rgb(1,2)", "rgb(a,b,c)", "rgb(1 2 3 4 5)", "notacolour"]) {
      expect(parseInkColor(bad)).toBeNull();
    }
  });

  it("formats opaque colours as #rrggbb and others as #rrggbbaa", () => {
    expect(formatInkColor({ r: 255, g: 0, b: 10, a: 1 })).toBe("#ff000a");
    expect(formatInkColor({ r: 255, g: 0, b: 10, a: 0.5 })).toBe("#ff000a80");
    expect(formatInkColor({ r: 0, g: 0, b: 0, a: 0 })).toBe("#00000000");
  });

  it("round-trips through the formatter", () => {
    for (const text of ["#102030", "#10203040", "#ffffff", "#00000000"]) {
      const color = parseInkColor(text);
      expect(color && formatInkColor(color)).toBe(text);
    }
  });

  it("compares colours at stored precision", () => {
    expect(inkColorsEqual({ r: 1, g: 2, b: 3, a: 0.5 }, { r: 1, g: 2, b: 3, a: 128 / 255 })).toBe(true);
    expect(inkColorsEqual({ r: 1, g: 2, b: 3, a: 1 }, { r: 1, g: 2, b: 4, a: 1 })).toBe(false);
  });
});
