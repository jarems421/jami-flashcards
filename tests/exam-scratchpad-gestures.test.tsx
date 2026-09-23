// @vitest-environment jsdom

import { act, forwardRef, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The working sheet's fingers, driven the way an iPad drives them.
 *
 * Every contact here is 45px across -- about what iPadOS reports for a
 * fingertip, and wider than the 40px the sheet used to throw away as a palm.
 * That check is why page turns and new sheets did not work on a tablet.
 */

const inkSpies = vi.hoisted(() => ({
  latest: null as null | {
    onInteractionChange(active: boolean): void;
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  },
}));

vi.mock("@/components/workspace/NotebookInkEditor", () => ({
  NotebookInkEditor: forwardRef<unknown, Record<string, unknown>>(
    function MockNotebookInkEditor(props) {
      // The real editor hands touches to these props and lets them bubble.
      return (
        <div
          ref={() => {
            inkSpies.latest = props as never;
          }}
          data-testid="ink-surface"
          className="notebook-ink-surface absolute inset-0"
          onPointerDown={props.onPointerDown as never}
          onPointerMove={props.onPointerMove as never}
          onPointerUp={props.onPointerUp as never}
          onPointerCancel={props.onPointerCancel as never}
        />
      );
    }
  ),
}));

vi.mock("@/components/practice/ExamSheetPageBackground", () => ({
  default: () => null,
}));

vi.mock("@/services/study/exam-practice", () => ({
  ExamScratchpadTooLargeError: class ExamScratchpadTooLargeError extends Error {},
  loadExamScratchpad: vi.fn(async () => []),
  saveExamScratchpad: vi.fn(async () => undefined),
}));

import ExamScratchpad from "@/components/practice/ExamScratchpad";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const FRAME_WIDTH = 800;
const originals = new Map<string, PropertyDescriptor | undefined>();
let container: HTMLDivElement;
let root: Root;
let now = 10_000;

function stub(target: object, key: string, descriptor: PropertyDescriptor) {
  originals.set(key, Object.getOwnPropertyDescriptor(target, key));
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
}

const isFrame = (element: HTMLElement) => element.hasAttribute("data-notebook-page-frame");
const isPage = (element: HTMLElement) => element.classList.contains("notebook-page-surface");

function rectOf(element: HTMLElement) {
  if (isFrame(element)) {
    const height = element.clientHeight;
    return { left: 0, top: 0, width: FRAME_WIDTH, height };
  }
  if (isPage(element)) {
    const match = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(element.style.transform);
    return {
      left: Number(match?.[1] ?? 0),
      top: Number(match?.[2] ?? 0),
      width: parseFloat(element.style.width) || 0,
      height: parseFloat(element.style.height) || 0,
    };
  }
  return { left: 0, top: 0, width: 0, height: 0 };
}

beforeAll(() => {
  const captured = new WeakMap<Element, Set<number>>();
  stub(HTMLElement.prototype, "clientWidth", {
    get(this: HTMLElement) {
      return isFrame(this) ? FRAME_WIDTH : 0;
    },
  });
  stub(HTMLElement.prototype, "clientHeight", {
    get(this: HTMLElement) {
      return isFrame(this) ? parseFloat(this.style.height) || 1100 : 0;
    },
  });
  stub(HTMLElement.prototype, "getBoundingClientRect", {
    value(this: HTMLElement) {
      const rect = rectOf(this);
      return {
        ...rect,
        x: rect.left,
        y: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: () => rect,
      };
    },
  });
  stub(HTMLElement.prototype, "setPointerCapture", {
    value(this: HTMLElement, pointerId: number) {
      const set = captured.get(this) ?? new Set<number>();
      set.add(pointerId);
      captured.set(this, set);
    },
  });
  stub(HTMLElement.prototype, "hasPointerCapture", {
    value(this: HTMLElement, pointerId: number) {
      return captured.get(this)?.has(pointerId) ?? false;
    },
  });
  stub(HTMLElement.prototype, "releasePointerCapture", {
    value(this: HTMLElement, pointerId: number) {
      captured.get(this)?.delete(pointerId);
    },
  });
  // Reduced motion lands a page turn at once rather than after its animation.
  stub(window, "matchMedia", {
    value: (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

afterAll(() => {
  for (const [key, descriptor] of originals) {
    const target = key === "matchMedia" ? window : HTMLElement.prototype;
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete (target as unknown as Record<string, unknown>)[key];
  }
});

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ExamScratchpad
        userId="student"
        attemptId="attempt-1"
        embedded
        printedPages={[]}
        questionLabel="1"
        assetPath={(assetId) => assetId}
        onHandle={() => undefined}
      />
    );
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

function pointer(
  target: Element,
  type: string,
  init: { x: number; y: number; id?: number; kind?: string }
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x,
    clientY: init.y,
  });
  Object.defineProperties(event, {
    isPrimary: { value: (init.id ?? 1) === 1 },
    pointerId: { value: init.id ?? 1 },
    pointerType: { value: init.kind ?? "touch" },
    width: { value: 45 },
    height: { value: 45 },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

const inkSurface = () => {
  const surface = container.querySelector('[data-testid="ink-surface"]');
  if (!surface) throw new Error("The sheet should have mounted its ink surface.");
  return surface;
};

/** One finger dragged across the page and lifted. */
function swipe(fromX: number, toX: number, y = 400) {
  const surface = inkSurface();
  pointer(surface, "pointerdown", { x: fromX, y });
  const steps = 6;
  for (let step = 1; step <= steps; step += 1) {
    pointer(surface, "pointermove", { x: fromX + ((toX - fromX) * step) / steps, y });
  }
  pointer(surface, "pointerup", { x: toX, y });
}

const pageCounter = () =>
  container.querySelector('[aria-label="Pages"] span[aria-live]')?.textContent?.replace(/\s+/g, " ");

describe("the working sheet under a finger", () => {
  it("pulls another sheet in past the last page", () => {
    expect(pageCounter()).toBe("1 / 1");
    swipe(700, 100);
    expect(pageCounter()).toBe("2 / 2");
  });

  it("turns back and forward with a swipe", () => {
    swipe(700, 100);
    expect(pageCounter()).toBe("2 / 2");

    swipe(100, 700);
    expect(pageCounter()).toBe("1 / 2");

    swipe(700, 100);
    expect(pageCounter()).toBe("2 / 2");
  });

  it("no longer tells a student they have run out of room", () => {
    expect(container.textContent).not.toContain("Run out of room");
    // The toolbar still offers a sheet to anyone who looks for one.
    expect(container.querySelector('[aria-label="Add another sheet"]')).not.toBeNull();
  });

  it("takes a hand on the page while the Pencil writes for a palm, not a swipe", () => {
    act(() => inkSpies.latest?.onInteractionChange(true));
    swipe(700, 100);
    act(() => inkSpies.latest?.onInteractionChange(false));
    expect(pageCounter()).toBe("1 / 1");

    // Just after the Pencil lifts, the hand is still the Pencil's.
    swipe(700, 100);
    expect(pageCounter()).toBe("1 / 1");

    now += 500;
    swipe(700, 100);
    expect(pageCounter()).toBe("2 / 2");
  });

  it("pinches to zoom like a notebook page, and a zoomed page pans rather than turns", () => {
    swipe(700, 100);
    swipe(100, 700);
    expect(pageCounter()).toBe("1 / 2");

    const surface = inkSurface();
    pointer(surface, "pointerdown", { x: 300, y: 400, id: 1 });
    pointer(surface, "pointerdown", { x: 500, y: 400, id: 2 });
    for (let step = 1; step <= 5; step += 1) {
      pointer(surface, "pointermove", { x: 300 - step * 30, y: 400, id: 1 });
      pointer(surface, "pointermove", { x: 500 + step * 30, y: 400, id: 2 });
    }
    pointer(surface, "pointerup", { x: 650, y: 400, id: 2 });
    pointer(surface, "pointerup", { x: 150, y: 400, id: 1 });

    // Zoomed inline, the way back to the fitted page appears.
    const fit = container.querySelector<HTMLButtonElement>('[aria-label="Fit the page"]');
    expect(fit).not.toBeNull();
    expect(fit?.textContent).toMatch(/%$/);

    // One finger now moves the page. It does not turn it.
    swipe(700, 100);
    expect(pageCounter()).toBe("1 / 2");

    act(() => {
      fit?.click();
    });
    expect(container.querySelector('[aria-label="Fit the page"]')).toBeNull();
    swipe(700, 100);
    expect(pageCounter()).toBe("2 / 2");
  });
});
