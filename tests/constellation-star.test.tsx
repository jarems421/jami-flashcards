// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import type { NormalizedStar } from "@/lib/constellation/stars";

const star: NormalizedStar = {
  id: "star-1",
  goalId: "goal-1",
  constellationId: "constellation-1",
  size: 30,
  glow: 0.5,
  position: { x: 50, y: 50 },
  createdAt: 1,
  needsBackfill: false,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ConstellationStar", () => {
  it("lets a keyboard user move an editable star", () => {
    const onNudge = vi.fn();
    act(() => {
      root.render(
        <ConstellationStar
          star={star}
          label="Goal reward"
          onDragStart={() => undefined}
          onNudge={onNudge}
        />
      );
    });

    const control = container.querySelector("button");
    expect(control?.getAttribute("aria-label")).toContain("arrow keys");
    act(() => {
      control?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })
      );
    });
    expect(onNudge).toHaveBeenCalledWith({ x: 49, y: 50 });
  });

  it("keeps non-editable preview stars out of the tab order", () => {
    act(() => {
      root.render(<ConstellationStar star={star} variant="preview" />);
    });

    expect(container.querySelector("button")).toBeNull();
  });

  /*
   * iPad settles whether a touch may scroll the page from the `touch-action` of
   * the element under the finger, at the moment the touch begins, and nothing
   * later takes that back. So the button itself has to refuse -- the invisible
   * hit area inside it doing so is not enough, because the press lands here.
   *
   * Asserted rather than left to review because this exact bug has been
   * "fixed" more than once by adding another preventDefault somewhere else.
   */
  it("refuses touch gestures on the star a finger actually presses", () => {
    act(() => {
      root.render(
        <ConstellationStar
          star={star}
          label="Goal reward"
          onDragStart={() => undefined}
        />
      );
    });

    const control = container.querySelector("button");
    expect(control).not.toBeNull();
    expect(control?.className).toContain("touch-none");
  });
});

/**
 * The sky is meant to look alive from behind a page, and twice now it has
 * quietly stopped: once when sparkles were rationed to stars over 36px, which
 * excluded most of a sky whose stars run from 18 to 52, and once when every
 * star breathed to the same shallow floor. Neither shows up in a type error and
 * both read as "the stars do not twinkle any more".
 */
describe("the background sky stays alive", () => {
  /** The animated elements a star renders: its body, then its sparkles. */
  function twinklingParts() {
    return [...container.querySelectorAll<HTMLElement>("div")].filter((node) =>
      node.style.animationName.startsWith("constellation-")
    );
  }

  it("sparkles on a small background star, not only the large ones", () => {
    act(() => {
      root.render(
        <ConstellationStar
          // Below the 36px floor that used to decide this, and the commonest
          // size in a real sky.
          star={{ ...star, size: 0 }}
          variant="background"
        />
      );
    });

    const sparkles = twinklingParts().filter(
      (node) => node.style.animationName === "constellation-sparkle"
    );
    expect(sparkles.length).toBeGreaterThan(0);
    // Small enough to be proportional, large enough to find behind a page.
    for (const sparkle of sparkles) {
      expect(Number.parseFloat(sparkle.style.width)).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives each star its own depth of breath", () => {
    const floors = new Set<string>();

    for (const id of ["star-a", "star-b", "star-c", "star-d"]) {
      act(() => {
        root.render(
          <ConstellationStar star={{ ...star, id }} variant="background" />
        );
      });

      const body = twinklingParts().find(
        (node) => node.style.animationName === "constellation-twinkle"
      );
      const floor = body?.style.getPropertyValue("--twinkle-floor") ?? "";
      expect(floor).not.toBe("");
      // Deeper than the fixed 0.76 it replaced, and never so deep the star
      // reads as going out.
      expect(Number.parseFloat(floor)).toBeGreaterThanOrEqual(0.45);
      expect(Number.parseFloat(floor)).toBeLessThanOrEqual(0.8);
      floors.add(floor);
    }

    // Four stars in step at the same depth is a setting, not a sky.
    expect(floors.size).toBeGreaterThan(1);
  });
});
