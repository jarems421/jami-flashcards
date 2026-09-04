// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ConstellationLines from "@/components/constellation/ConstellationLines";
import ConstellationStar from "@/components/constellation/ConstellationStar";
import type { NormalizedStar } from "@/lib/constellation/stars";

/**
 * Drawing a line used to be aimed blind: the half-drawn line followed the
 * finger, nothing said which star it would land on, and the drop was a guess
 * that either joined two stars or quietly did nothing.
 *
 * The snap is the fix, and it is two things at once -- the line ends on the
 * star rather than under the finger, and the star it would join wears a ring.
 * Both are easy to lose in a refactor and neither shows up in a type error.
 */

function makeStar(id: string, x: number, y: number): NormalizedStar {
  return {
    id,
    goalId: `goal-${id}`,
    constellationId: "constellation-1",
    size: 30,
    glow: 0.5,
    position: { x, y },
    createdAt: 1,
    needsBackfill: false,
  };
}

const stars = [makeStar("alpha", 20, 20), makeStar("beta", 80, 60)];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The last line element drawn, which is the pending one when there is one. */
function pendingCore() {
  const lines = [...container.querySelectorAll("line")];
  return lines[lines.length - 1] ?? null;
}

describe("the half-drawn line", () => {
  it("ends under the pointer while it is over nothing", () => {
    act(() => {
      root.render(
        <ConstellationLines
          lines={[]}
          stars={stars}
          pending={{ fromStarId: "alpha", x: 55, y: 40, toStarId: null }}
        />
      );
    });

    const line = pendingCore();
    expect(line?.getAttribute("x2")).toBe("55");
    expect(line?.getAttribute("y2")).toBe("40");
    // Unjoined, it drifts: a dashed thread rather than a finished line.
    expect(line?.getAttribute("class")).toContain("constellation-line-drift");
  });

  it("snaps onto the star it would join, and stops drifting", () => {
    act(() => {
      root.render(
        <ConstellationLines
          lines={[]}
          stars={stars}
          // The pointer is nowhere near beta, but beta is what is under it.
          pending={{ fromStarId: "alpha", x: 55, y: 40, toStarId: "beta" }}
        />
      );
    });

    const line = pendingCore();
    expect(line?.getAttribute("x2")).toBe("80");
    expect(line?.getAttribute("y2")).toBe("60");
    // Holding still is the signal that letting go will join them.
    expect(line?.getAttribute("class") ?? "").not.toContain(
      "constellation-line-drift"
    );
  });

  it("ignores a star id that is not in this sky", () => {
    act(() => {
      root.render(
        <ConstellationLines
          lines={[]}
          stars={stars}
          pending={{ fromStarId: "alpha", x: 55, y: 40, toStarId: "gone" }}
        />
      );
    });

    expect(pendingCore()?.getAttribute("x2")).toBe("55");
  });
});

describe("a drawn line", () => {
  it("fades out at both ends rather than meeting the stars squarely", () => {
    act(() => {
      root.render(
        <ConstellationLines
          lines={[{ a: "alpha", b: "beta" }]}
          stars={stars}
        />
      );
    });

    const stops = [...container.querySelectorAll("linearGradient")][0]
      ?.querySelectorAll("stop");
    expect(stops?.length).toBeGreaterThan(2);
    // Transparent at both ends, opaque in the middle: the line dissolves before
    // it reaches the star it points at.
    expect(stops?.[0].getAttribute("stop-color")).toContain(", 0)");
    expect(
      stops?.[stops.length - 1].getAttribute("stop-color")
    ).toContain(", 0)");
  });

  it("keeps a hit area wide enough for a finger", () => {
    act(() => {
      root.render(
        <ConstellationLines
          lines={[{ a: "alpha", b: "beta" }]}
          stars={stars}
          onRemoveLine={() => undefined}
        />
      );
    });

    const hit = [...container.querySelectorAll("line")].find(
      (line) => line.getAttribute("stroke") === "transparent"
    );
    expect(hit).toBeTruthy();
    // Swiping a line in Connect mode must not scroll the page instead.
    expect(hit?.style.touchAction).toBe("none");
  });
});

describe("the star a line is about to reach", () => {
  it("wears a ring, and the ring is round rather than a box", () => {
    act(() => {
      root.render(
        <ConstellationStar
          star={stars[0]}
          interaction="connect"
          isLinkTarget
          onDragStart={() => undefined}
          onActivate={() => undefined}
        />
      );
    });

    const ring = container.querySelector<HTMLElement>("[data-star-ring]");
    expect(ring).toBeTruthy();
    // A ring, never a disc: the sky draws nothing solid behind a star.
    expect(ring?.style.background).toBe("");
    expect(container.querySelector("button")?.className).toContain(
      "rounded-full"
    );
  });

  it("carries a touch target a finger can land on, whatever the star's size", () => {
    // The drawn star is 18px at its smallest and the bloom around it is over
    // three times wider, so a button at star size is a quarter of what somebody
    // is aiming at. Missing it puts the press on the sky, where the browser is
    // free to read the drag as a page scroll -- which is the screen moving when
    // somebody meant to move a star.
    act(() => {
      root.render(
        <ConstellationStar
          star={{ ...stars[0], size: 0 }}
          interaction="connect"
          onDragStart={() => undefined}
          onActivate={() => undefined}
        />
      );
    });

    const target = container.querySelector<HTMLElement>("[data-star-hit-area]");
    expect(Number.parseFloat(target?.style.width ?? "0")).toBeGreaterThanOrEqual(44);
    expect(target?.style.height).toBe(target?.style.width);
    expect(target?.className).toContain("touch-none");
    expect(container.querySelector("button")?.className).toContain("touch-none");
  });

  it("draws no ring when nothing is being connected", () => {
    act(() => {
      root.render(
        <ConstellationStar
          star={stars[0]}
          interaction="connect"
          onDragStart={() => undefined}
          onActivate={() => undefined}
        />
      );
    });

    expect(container.querySelector("[data-star-ring]")).toBeNull();
  });

  it("breathes while it is the star being dragged from, not the target", () => {
    act(() => {
      root.render(
        <ConstellationStar
          star={stars[0]}
          interaction="connect"
          isLinkSource
          onDragStart={() => undefined}
          onActivate={() => undefined}
        />
      );
    });

    expect(container.querySelector("[data-star-ring]")?.className).toContain(
      "constellation-star-ring"
    );
  });
});
