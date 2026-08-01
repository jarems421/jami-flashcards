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
  color: "gold",
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
});
