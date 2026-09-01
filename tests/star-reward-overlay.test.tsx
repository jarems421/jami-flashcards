// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StarRewardOverlay from "@/components/constellation/StarRewardOverlay";
import type { Star } from "@/lib/constellation/stars";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// jsdom does not give this file a file: URL, so the repo root comes from cwd.
const rootDir = process.cwd();

const HOLD_MS = 3_200;
const FADE_MS = 300;

const star: Star = {
  id: "onboarding-first-loop",
  goalId: "",
  constellationId: "constellation-1",
  size: 22,
  glow: 0.85,
  position: { x: 50, y: 50 },
  createdAt: 1,
  rewardKind: "onboarding",
  rewardLabel: "First study loop",
};

let container: HTMLDivElement;
let root: Root;
const onDone = vi.fn();

async function render(reward: { star: Star; goalName: string } | null) {
  await act(async () => {
    root.render(<StarRewardOverlay reward={reward} onDone={onDone} />);
  });
}

const overlay = () =>
  document.querySelector<HTMLDivElement>(".star-reward-overlay");
const card = () => document.querySelector<HTMLDivElement>(".star-reward-card");

function pointerDown(target: EventTarget) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true })
    );
  });
}

function escape() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  onDone.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("the star reward moment", () => {
  it("shows nothing until there is a reward", async () => {
    await render(null);
    expect(overlay()).toBeNull();
  });

  it("names what the star was earned for", async () => {
    await render({ star, goalName: "First study loop" });

    expect(overlay()).not.toBeNull();
    expect(overlay()?.textContent).toContain("Star earned");
    expect(overlay()?.textContent).toContain("First study loop");
  });

  /*
   * The walkthrough star has no goal behind it -- goalId is "" -- and this
   * announced "Goal complete: First study loop" for it, telling a student
   * using a reader they had completed a goal they never set. The old
   * assertion locked that in.
   */
  it("does not call the walkthrough star a completed goal", async () => {
    await render({ star, goalName: "First study loop" });

    expect(document.body.textContent).toContain(
      "Walkthrough complete: First study loop. You earned a star."
    );
    expect(document.body.textContent).not.toContain("Goal complete");
  });

  it("does call a goal star a completed goal", async () => {
    await render({
      star: { ...star, id: "goal-1", goalId: "goal-1", rewardKind: "goal", rewardLabel: undefined },
      goalName: "Fifty cards at ninety percent",
    });

    expect(document.body.textContent).toContain(
      "Goal complete: Fifty cards at ninety percent. You earned a star."
    );
  });

  it("leaves on its own after the hold", async () => {
    await render({ star, goalName: "First study loop" });

    await advance(HOLD_MS - 1);
    expect(onDone).not.toHaveBeenCalled();

    await advance(1 + FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ends immediately on a tap outside the card", async () => {
    await render({ star, goalName: "First study loop" });

    const target = overlay();
    expect(target).not.toBeNull();
    pointerDown(target!);

    await advance(FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ends immediately on a tap on the card itself", async () => {
    await render({ star, goalName: "First study loop" });

    const target = card();
    expect(target).not.toBeNull();
    pointerDown(target!);

    await advance(FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("ends immediately on Escape", async () => {
    await render({ star, goalName: "First study loop" });

    escape();
    await advance(FADE_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("only finishes once, however it is dismissed", async () => {
    await render({ star, goalName: "First study loop" });

    escape();
    pointerDown(overlay()!);
    await advance(HOLD_MS + FADE_MS);

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("offers View Stars, which closes the moment and goes to the constellation", async () => {
    await render({ star, goalName: "First study loop" });

    const link = Array.from(document.querySelectorAll("a")).find((anchor) =>
      anchor.textContent?.includes("View Stars")
    );
    expect(link?.getAttribute("href")).toBe("/dashboard/constellation");

    act(() => {
      link?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("the star reward's motion", () => {
  const styles = readFileSync(path.join(rootDir, "app/globals.css"), "utf8");

  it("has no blurred bloom left anywhere in it", () => {
    expect(styles).not.toContain("star-reward-bloom");
    const block = styles.slice(
      styles.indexOf("/* Star reward moment"),
      styles.indexOf("@keyframes ai-thinking-dot")
    );
    expect(block).not.toContain("filter: blur");
    expect(block).not.toContain("backdrop-filter");
  });

  it("flies the star in on a curve, using two axes with different easings", () => {
    expect(styles).toContain("@keyframes star-reward-arc-x");
    expect(styles).toContain("@keyframes star-reward-arc-y");
    const x = styles.slice(styles.indexOf(".star-reward-arc {"));
    const y = styles.slice(styles.indexOf(".star-reward-star {"));
    expect(x.slice(0, 200)).toContain("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(y.slice(0, 200)).toContain("cubic-bezier(0.5, 0, 0.2, 1)");
  });

  it("traces the outline before the solid star resolves", () => {
    expect(styles).toContain("@keyframes star-reward-draw");
    expect(styles).toContain("stroke-dasharray: 620");
  });

  it("under reduced motion shows the finished star with no animation", () => {
    const reduced = styles.slice(
      styles.indexOf("@media (prefers-reduced-motion: reduce)", styles.indexOf("/* Star reward moment"))
    );
    for (const layer of [
      ".star-reward-arc",
      ".star-reward-star",
      ".star-reward-trace",
      ".star-reward-core",
      ".star-reward-orbit",
    ]) {
      expect(reduced.slice(0, 900)).toContain(layer);
    }
    expect(reduced.slice(0, 1200)).toContain("stroke-dashoffset: 0");
    expect(reduced.slice(0, 1200)).toContain("transition: opacity 200ms ease");
  });
});
