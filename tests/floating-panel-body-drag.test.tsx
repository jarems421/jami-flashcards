// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFloatingPanel } from "@/hooks/useFloatingPanel";
import type { FloatingRect } from "@/lib/ui/floating-panel";

let container: HTMLDivElement;
let root: Root;

function Harness() {
  const frame = useFloatingPanel({
    storageKey: "test:floating-body-drag",
    enabled: true,
    preferredSize: { width: 300, height: 400 },
    limits: { minWidth: 200, minHeight: 200, margin: 12 },
  });
  if (!frame.rect) return null;
  return (
    <div data-testid="panel" data-rect={JSON.stringify(frame.rect)} {...frame.bodyDragProps}>
      <button type="button">Send</button>
      <svg data-testid="figure" />
      <div data-testid="gap" />
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <div data-testid="inside-list" />
      </div>
    </div>
  );
}

function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  pointerType: "mouse" | "touch" = "mouse"
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
    isPrimary: { value: true },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`)!;
const rect = () => JSON.parse(byTestId("panel").getAttribute("data-rect")!) as FloatingRect;

beforeEach(() => {
  localStorage.clear();
  const captured = new Set<number>();
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness />));
  // The conversation overflows, so a swipe in it is a scroll.
  const scroller = byTestId("scroller") as HTMLElement;
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 300 },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("moving a floating panel by its body", () => {
  it("picks the panel up from any bare part of it, not only the header", () => {
    const start = rect();
    const gap = byTestId("gap");
    pointer(gap, "pointerdown", 100, 100);
    pointer(gap, "pointermove", 60, 70);
    pointer(gap, "pointerup", 60, 70);

    expect(rect()).toMatchObject({ x: start.x - 40, y: start.y - 30, width: start.width, height: start.height });
  });

  it("leaves controls and pictures to their own gestures", () => {
    const start = rect();
    for (const target of [container.querySelector("button")!, byTestId("figure")]) {
      pointer(target, "pointerdown", 100, 100);
      pointer(target, "pointermove", 20, 20);
      pointer(target, "pointerup", 20, 20);
    }
    expect(rect()).toEqual(start);
  });

  it("lets a finger scroll the conversation, and moves the panel only after a hold", () => {
    vi.useFakeTimers();
    const start = rect();
    const inside = byTestId("inside-list");

    // A swipe: moves before the hold is up, so it is a scroll.
    pointer(inside, "pointerdown", 100, 100, "touch");
    pointer(inside, "pointermove", 100, 60, "touch");
    act(() => vi.advanceTimersByTime(400));
    pointer(inside, "pointermove", 100, 20, "touch");
    pointer(inside, "pointerup", 100, 20, "touch");
    expect(rect()).toEqual(start);

    // A hold, then a drag: the panel follows the finger.
    pointer(inside, "pointerdown", 100, 100, "touch");
    act(() => vi.advanceTimersByTime(350));
    pointer(inside, "pointermove", 70, 80, "touch");
    pointer(inside, "pointerup", 70, 80, "touch");
    expect(rect()).toMatchObject({ x: start.x - 30, y: start.y - 20 });
  });
});
