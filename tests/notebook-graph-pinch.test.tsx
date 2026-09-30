// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotebookGraphLayer from "@/components/workspace/NotebookGraphLayer";
import { createNotebookGraphBlock, type NotebookGraphBlock } from "@/lib/workspace/notebook-graphs";

/**
 * A graph already on the page, pinched with two fingers.
 *
 * Once a graph was placed, its zoom buttons were the only way to look closer;
 * a second finger on it was taken as a new drag and the first was dropped.
 * Two fingers now zoom what it shows, and leave where it sits alone.
 */

let container: HTMLDivElement;
let root: Root;
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const captured = new Set<number>();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 800,
    bottom: 1000,
    width: 800,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function flushFrames() {
  const run = frames;
  frames = [];
  act(() => run.forEach((callback) => callback(0)));
}

function touch(target: Element, type: string, id: number, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, {
    pointerId: { value: id },
    pointerType: { value: "touch" },
    isPrimary: { value: id === 1 },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

function renderGraph() {
  const graph = createNotebookGraphBlock("g1", {
    view: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
    series: [{ id: "s1", kind: "function", expression: "x^2", color: "#123456", angleUnit: "radians" }],
  });
  const onCommit = vi.fn<(graphs: NotebookGraphBlock[]) => void>();
  act(() => {
    root.render(
      <NotebookGraphLayer graphs={[graph]} editingEnabled selectedGraphId="g1" onSelect={() => undefined} onCommit={onCommit} />
    );
  });
  const handle = container.querySelector<HTMLButtonElement>('button[aria-label^="Move graph"]')!;
  return { graph, onCommit, handle };
}

describe("a graph on the page", () => {
  it("zooms in under two spreading fingers, and stays where it was put", () => {
    const { graph, onCommit, handle } = renderGraph();
    touch(handle, "pointerdown", 1, 300, 500);
    touch(handle, "pointerdown", 2, 400, 500);
    touch(handle, "pointermove", 1, 250, 500);
    touch(handle, "pointermove", 2, 450, 500);
    flushFrames();
    touch(handle, "pointerup", 2, 450, 500);
    touch(handle, "pointerup", 1, 250, 500);

    expect(onCommit).toHaveBeenCalledTimes(1);
    const [pinched] = onCommit.mock.calls[0]![0];
    expect(pinched!.view.xMax - pinched!.view.xMin).toBeCloseTo(10);
    expect(pinched!.view.yMax - pinched!.view.yMin).toBeCloseTo(10);
    expect({ x: pinched!.x, y: pinched!.y, width: pinched!.width }).toEqual({ x: graph.x, y: graph.y, width: graph.width });
  });

  it("still moves under one finger, showing the same part of the graph", () => {
    const { graph, onCommit, handle } = renderGraph();
    touch(handle, "pointerdown", 1, 300, 500);
    touch(handle, "pointermove", 1, 380, 500);
    flushFrames();
    touch(handle, "pointerup", 1, 380, 500);

    expect(onCommit).toHaveBeenCalledTimes(1);
    const [moved] = onCommit.mock.calls[0]![0];
    expect(moved!.x).toBeGreaterThan(graph.x);
    expect(moved!.view).toEqual(graph.view);
  });

  it("saves nothing when two fingers rest on it without moving", () => {
    const { onCommit, handle } = renderGraph();
    touch(handle, "pointerdown", 1, 300, 500);
    touch(handle, "pointerdown", 2, 400, 500);
    touch(handle, "pointerup", 2, 400, 500);
    touch(handle, "pointerup", 1, 300, 500);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
