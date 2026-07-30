import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isNotebookStylusTouchEvent,
  installNotebookStylusTouchListeners,
  NOTEBOOK_STYLUS_ACTION_SELECTOR,
  NOTEBOOK_TEXT_EDITOR_SELECTOR,
} from "@/lib/workspace/notebook-interaction-lock";
import { prepareNotebookExit } from "@/lib/workspace/notebook-navigation";
import { trackNotebookPdfCanvas } from "@/lib/workspace/notebook-pdf-canvas";
import { createNotebookPinchFrameQueue } from "@/lib/workspace/notebook-viewport";

describe("notebook exit preparation", () => {
  it("leaves clean and in-flight saves alone", () => {
    for (const saveStatus of ["saved", "saving"] as const) {
      const persistDraftSync = vi.fn();
      const queueSaveForExit = vi.fn(() => true);

      expect(
        prepareNotebookExit({
          saveStatus,
          persistDraftSync,
          queueSaveForExit,
        })
      ).toEqual({
        hasPendingChanges: false,
        saveQueued: false,
        shouldPreventNavigation: false,
      });
      expect(persistDraftSync).not.toHaveBeenCalled();
      expect(queueSaveForExit).not.toHaveBeenCalled();
    }
  });

  it("writes the draft before synchronously queueing pending page content", () => {
    const calls: string[] = [];

    const decision = prepareNotebookExit({
      saveStatus: "unsaved",
      persistDraftSync: () => calls.push("draft"),
      queueSaveForExit: () => {
        calls.push("save");
        return true;
      },
    });

    expect(calls).toEqual(["draft", "save"]);
    expect(decision).toEqual({
      hasPendingChanges: true,
      saveQueued: true,
      shouldPreventNavigation: false,
    });
    expect(decision).not.toBeInstanceOf(Promise);
  });

  it("blocks navigation when a failed page cannot be queued", () => {
    expect(
      prepareNotebookExit({
        saveStatus: "failed",
        persistDraftSync: vi.fn(),
        queueSaveForExit: () => false,
      })
    ).toEqual({
      hasPendingChanges: true,
      saveQueued: false,
      shouldPreventNavigation: true,
    });
  });
});

describe("keyed notebook PDF canvas tracking", () => {
  it("tracks a ready canvas under its render key", () => {
    const canvas = { id: "canvas-2" };

    expect(
      trackNotebookPdfCanvas({
        current: { canvas: null, renderKey: null },
        renderKey: "page-2:file-1:1",
        canvas,
      })
    ).toEqual({
      canvas,
      renderKey: "page-2:file-1:1",
    });
  });

  it("clears the canvas only when the settling render still owns it", () => {
    const current = {
      canvas: { id: "canvas-2" },
      renderKey: "page-2:file-1:1",
    };

    expect(
      trackNotebookPdfCanvas({
        current,
        renderKey: "page-2:file-1:1",
        canvas: null,
      })
    ).toEqual({ canvas: null, renderKey: null });

    expect(
      trackNotebookPdfCanvas({
        current,
        renderKey: "page-1:file-1:0",
        canvas: null,
      })
    ).toBe(current);
  });

  it("lets a newer keyed canvas replace the previous render", () => {
    const nextCanvas = { id: "canvas-3" };

    expect(
      trackNotebookPdfCanvas({
        current: {
          canvas: { id: "canvas-2" },
          renderKey: "page-2:file-1:1",
        },
        renderKey: "page-3:file-1:2",
        canvas: nextCanvas,
      })
    ).toEqual({
      canvas: nextCanvas,
      renderKey: "page-3:file-1:2",
    });
  });
});

describe("notebook pinch frame queue", () => {
  function makeFrameScheduler() {
    let nextFrameId = 1;
    const callbacks = new Map<number, () => void>();
    const cancelFrame = vi.fn();
    const requestFrame = vi.fn((callback: () => void) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      callbacks.set(frameId, callback);
      return frameId;
    });

    return { callbacks, cancelFrame, requestFrame };
  }

  it("coalesces writes and runs the latest callback", () => {
    const scheduler = makeFrameScheduler();
    const queue = createNotebookPinchFrameQueue(scheduler);
    const first = vi.fn();
    const latest = vi.fn();

    queue.queue(first);
    queue.queue(latest);

    expect(scheduler.requestFrame).toHaveBeenCalledTimes(1);
    expect(queue.hasPendingFrame()).toBe(true);
    scheduler.callbacks.get(1)?.();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(queue.hasPendingFrame()).toBe(false);
  });

  it("cancels a pending write and ignores its stale callback", () => {
    const scheduler = makeFrameScheduler();
    const queue = createNotebookPinchFrameQueue(scheduler);
    const cancelled = vi.fn();
    const current = vi.fn();

    queue.queue(cancelled);
    queue.cancel();
    queue.queue(current);

    expect(scheduler.cancelFrame).toHaveBeenCalledWith(1);
    expect(queue.hasPendingFrame()).toBe(true);
    scheduler.callbacks.get(1)?.();
    expect(cancelled).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(queue.hasPendingFrame()).toBe(true);

    scheduler.callbacks.get(2)?.();
    expect(current).toHaveBeenCalledTimes(1);
    expect(queue.hasPendingFrame()).toBe(false);
  });
});

describe("notebook stylus touch listeners", () => {
  class TestTouchEvent extends Event {
    readonly touches: TouchList;
    readonly changedTouches: TouchList;

    constructor(input: {
      cancelable?: boolean;
      target: EventTarget | null;
      touches?: Array<{ touchType?: string }>;
      changedTouches?: Array<{ touchType?: string }>;
    }) {
      super("touchmove", { cancelable: input.cancelable ?? true });
      this.touches = (input.touches ?? []) as unknown as TouchList;
      this.changedTouches = (input.changedTouches ?? []) as unknown as TouchList;
      Object.defineProperty(this, "target", {
        configurable: true,
        value: input.target,
      });
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeTarget(...matchingSelectors: string[]) {
    const matches = new Set(matchingSelectors);
    return {
      closest: vi.fn((selector: string) =>
        matches.has(selector) ? {} : null
      ),
    } as unknown as EventTarget;
  }

  function makeSurface() {
    const listeners = new Map<
      string,
      { listener: EventListener; options?: boolean | AddEventListenerOptions }
    >();
    const addEventListener = vi.fn(
      (
        type: string,
        listener: EventListener,
        options?: boolean | AddEventListenerOptions
      ) => {
        listeners.set(type, { listener, options });
      }
    );
    const removeEventListener = vi.fn();
    const surface = {
      addEventListener,
      removeEventListener,
    } as unknown as EventTarget;

    return { addEventListener, listeners, removeEventListener, surface };
  }

  it("recognizes Pencil from active or changed touches", () => {
    expect(
      isNotebookStylusTouchEvent({
        touches: [{ touchType: "stylus" }] as unknown as TouchList,
        changedTouches: [] as unknown as TouchList,
      })
    ).toBe(true);
    expect(
      isNotebookStylusTouchEvent({
        touches: [] as unknown as TouchList,
        changedTouches: [{ touchType: "stylus" }] as unknown as TouchList,
      })
    ).toBe(true);
    expect(
      isNotebookStylusTouchEvent({
        touches: [{}] as unknown as TouchList,
        changedTouches: [{ touchType: "stylus" }] as unknown as TouchList,
      })
    ).toBe(false);
  });

  it("installs non-passive capture listeners and removes the same bindings", () => {
    vi.stubGlobal("TouchEvent", TestTouchEvent);
    const surface = makeSurface();
    const cleanup = installNotebookStylusTouchListeners({
      surface: surface.surface,
      getInkInteractionActive: () => false,
    });

    expect(surface.addEventListener).toHaveBeenCalledTimes(2);
    expect(surface.addEventListener).toHaveBeenNthCalledWith(
      1,
      "touchstart",
      expect.any(Function),
      { passive: false, capture: true }
    );
    expect(surface.addEventListener).toHaveBeenNthCalledWith(
      2,
      "touchmove",
      expect.any(Function),
      { passive: false, capture: true }
    );

    cleanup();

    expect(surface.removeEventListener).toHaveBeenCalledTimes(2);
    expect(surface.removeEventListener.mock.calls[0]?.[1]).toBe(
      surface.addEventListener.mock.calls[0]?.[1]
    );
    expect(surface.removeEventListener.mock.calls[0]?.[2]).toBe(
      surface.addEventListener.mock.calls[0]?.[2]
    );
    expect(surface.removeEventListener.mock.calls[1]?.[1]).toBe(
      surface.addEventListener.mock.calls[1]?.[1]
    );
    expect(surface.removeEventListener.mock.calls[1]?.[2]).toBe(
      surface.addEventListener.mock.calls[1]?.[2]
    );
  });

  it("suppresses bare-page Pencil gestures but preserves actions and text", () => {
    vi.stubGlobal("TouchEvent", TestTouchEvent);
    const surface = makeSurface();
    let inkInteractionActive = false;
    installNotebookStylusTouchListeners({
      surface: surface.surface,
      getInkInteractionActive: () => inkInteractionActive,
    });
    const listener = surface.listeners.get("touchmove")?.listener;
    expect(listener).toBeDefined();

    const barePagePencil = new TestTouchEvent({
      target: makeTarget(),
      touches: [{ touchType: "stylus" }],
    });
    listener?.(barePagePencil);
    expect(barePagePencil.defaultPrevented).toBe(true);

    const actionPencil = new TestTouchEvent({
      target: makeTarget(NOTEBOOK_STYLUS_ACTION_SELECTOR),
      touches: [{ touchType: "stylus" }],
    });
    listener?.(actionPencil);
    expect(actionPencil.defaultPrevented).toBe(false);

    inkInteractionActive = true;
    const activeInkOverText = new TestTouchEvent({
      target: makeTarget(NOTEBOOK_TEXT_EDITOR_SELECTOR),
      touches: [{}],
    });
    listener?.(activeInkOverText);
    expect(activeInkOverText.defaultPrevented).toBe(false);

    const activeInkOnPage = new TestTouchEvent({
      target: makeTarget(),
      touches: [{}],
    });
    listener?.(activeInkOnPage);
    expect(activeInkOnPage.defaultPrevented).toBe(true);
  });
});
