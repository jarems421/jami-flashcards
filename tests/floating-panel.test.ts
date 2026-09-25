import { describe, expect, it } from "vitest";
import {
  clampFloatingRect,
  cornerFloatingRect,
  maximisedFloatingRect,
  moveFloatingRect,
  parseStoredFloatingRect,
  resizeFloatingRect,
  restoreFloatingRectUnderPointer,
} from "@/lib/ui/floating-panel";

const VIEWPORT = { width: 1180, height: 820 };
const LIMITS = { minWidth: 340, minHeight: 340, margin: 12 };

describe("floating panel geometry", () => {
  it("starts in the bottom-right corner, inside the margin", () => {
    expect(cornerFloatingRect({ width: 360, height: 560 }, VIEWPORT, LIMITS)).toEqual({
      x: 1180 - 12 - 360,
      y: 820 - 12 - 560,
      width: 360,
      height: 560,
    });
  });

  it("stops a drag at the edge of the screen instead of losing the panel", () => {
    const start = { x: 800, y: 200, width: 360, height: 500 };
    expect(moveFloatingRect(start, 5000, -5000, VIEWPORT, LIMITS)).toEqual({
      x: 1180 - 12 - 360,
      y: 12,
      width: 360,
      height: 500,
    });
  });

  it("grows from the left edge without moving the right edge", () => {
    const start = { x: 800, y: 200, width: 360, height: 500 };
    const grown = resizeFloatingRect(start, { left: true }, -300, 0, VIEWPORT, LIMITS);
    expect(grown.x).toBe(500);
    expect(grown.x + grown.width).toBe(1160);
  });

  it("will not shrink below the minimum, and holds the opposite edge while refusing", () => {
    const start = { x: 800, y: 200, width: 360, height: 500 };
    const shrunk = resizeFloatingRect(start, { top: true, left: true }, 900, 900, VIEWPORT, LIMITS);
    expect(shrunk.width).toBe(340);
    expect(shrunk.height).toBe(340);
    expect(shrunk.x + shrunk.width).toBe(1160);
    expect(shrunk.y + shrunk.height).toBe(700);
  });

  it("can be resized all the way to full size but no further", () => {
    const start = { x: 800, y: 200, width: 360, height: 500 };
    const corner = resizeFloatingRect(start, { top: true, left: true }, -5000, -5000, VIEWPORT, LIMITS);
    const full = resizeFloatingRect(corner, { bottom: true, right: true }, 5000, 5000, VIEWPORT, LIMITS);
    expect(full).toEqual(maximisedFloatingRect(VIEWPORT, LIMITS));
    expect(full).toEqual({ x: 12, y: 12, width: 1156, height: 796 });
  });

  it("pulls a panel saved on a bigger screen back onto a smaller one", () => {
    const saved = { x: 1500, y: 900, width: 900, height: 1000 };
    const portrait = { width: 820, height: 1180 };
    const fitted = clampFloatingRect(saved, portrait, LIMITS);
    expect(fitted.x).toBeGreaterThanOrEqual(12);
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(820 - 12);
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(1180 - 12);
    expect(fitted.width).toBe(796);
  });

  it("dragged out of full size, comes back to its own size under the hand", () => {
    const own = { x: 800, y: 200, width: 360, height: 500 };
    const full = maximisedFloatingRect(VIEWPORT, LIMITS);
    // Held three quarters of the way across the full-size header.
    const pointer = { x: full.x + full.width * 0.75, y: 30 };
    const restored = restoreFloatingRectUnderPointer(own, full, pointer, VIEWPORT, LIMITS);
    expect(restored.width).toBe(360);
    expect(restored.height).toBe(500);
    expect(restored.y).toBe(full.y);
    expect(restored.x + restored.width * 0.75).toBeCloseTo(pointer.x);
  });

  it("only trusts a stored rectangle whose every field is a real size", () => {
    expect(parseStoredFloatingRect({ x: 1, y: 2, width: 300, height: 400 })).toEqual({
      x: 1,
      y: 2,
      width: 300,
      height: 400,
    });
    expect(parseStoredFloatingRect({ x: 1, y: 2, width: "300", height: 400 })).toBeNull();
    expect(parseStoredFloatingRect({ x: 1, y: 2, width: 0, height: 400 })).toBeNull();
    expect(parseStoredFloatingRect({ x: Number.NaN, y: 2, width: 300, height: 400 })).toBeNull();
    expect(parseStoredFloatingRect(null)).toBeNull();
  });
});
