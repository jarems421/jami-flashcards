// @vitest-environment jsdom

import { act, useCallback, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useNotebookPageTrack,
  type NotebookPageInkSnapshot,
  type NotebookPageTrack,
} from "@/hooks/useNotebookPageTrack";
import type { NotebookPageSwipeMotion } from "@/lib/workspace/notebook-carousel";

let container: HTMLDivElement;
let root: Root;
let track: NotebookPageTrack;
let trackEl: HTMLDivElement;
let previewEl: HTMLDivElement;
let selectedPageId: string | null;
let inkSvg: string;
let motions: (NotebookPageSwipeMotion | null)[];
let snapshots: (NotebookPageInkSnapshot | null)[];
let frames: FrameRequestCallback[];

function Harness() {
  const trackRef = useRef<HTMLDivElement | null>(trackEl);
  const previewLayerRef = useRef<HTMLDivElement | null>(previewEl);
  const noopRef = useRef<HTMLDivElement | null>(null);
  const circleRef = useRef<SVGCircleElement | null>(null);

  const value = useNotebookPageTrack({
    trackRef,
    previewLayerRef,
    createPageAffordanceRef: noopRef,
    createPageIndicatorRef: noopRef,
    createPageProgressCircleRef: circleRef,
    getSelectedPageId: useCallback(() => selectedPageId, []),
    getInkSnapshotSvg: useCallback(() => inkSvg, []),
    onSwipeMotionChange: useCallback((m: NotebookPageSwipeMotion | null) => {
      motions.push(m);
    }, []),
    onInkSnapshotChange: useCallback((s: NotebookPageInkSnapshot | null) => {
      snapshots.push(s);
    }, []),
  });

  useEffect(() => {
    track = value;
  });
  return null;
}

function motion(over: Partial<NotebookPageSwipeMotion> = {}) {
  return {
    phase: "settling",
    kind: "page",
    direction: "next",
    targetPage: null,
    targetOffset: -400,
    durationMs: 200,
    ...over,
  } as NotebookPageSwipeMotion;
}

beforeEach(() => {
  frames = [];
  motions = [];
  snapshots = [];
  selectedPageId = "page-1";
  inkSvg = "<svg data-page='1' />";

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => undefined;
  });

  container = document.createElement("div");
  document.body.append(container);
  trackEl = document.createElement("div");
  previewEl = document.createElement("div");
  trackEl.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;

  root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

function flushFrames() {
  const pending = frames.slice();
  frames = [];
  pending.forEach((cb) => cb(0));
}

describe("useNotebookPageTrack", () => {
  it("writes the offset straight to the compositor", () => {
    act(() => {
      track.writeOffset(-120);
    });
    expect(trackEl.style.transform).toBe("translate3d(-120px, 0, 0)");
    expect(track.offsetRef.current).toBe(-120);
  });

  it("coalesces queued offsets into one write per frame", () => {
    act(() => {
      track.queueOffset(-10);
      track.queueOffset(-40);
      track.queueOffset(-90);
    });
    // Offset is readable immediately; only the paint is deferred.
    expect(track.offsetRef.current).toBe(-90);
    expect(trackEl.style.transform).toBe("");

    act(() => {
      flushFrames();
    });
    expect(trackEl.style.transform).toBe("translate3d(-90px, 0, 0)");
  });

  it("marks the track active and directional while previewing", () => {
    act(() => {
      track.setPreviewVisibility(true);
      track.setPreviewDirection("next");
    });
    expect(previewEl.style.visibility).toBe("visible");
    expect(trackEl.dataset.swipeActive).toBe("true");
    expect(trackEl.dataset.swipeDirection).toBe("next");
  });

  it("clears preview state and drops the snapshot when hidden", () => {
    act(() => {
      track.captureInkSnapshot();
      track.setPreviewVisibility(true);
      track.setPreviewDirection("previous");
    });
    act(() => {
      track.setPreviewVisibility(false);
    });
    expect(previewEl.style.visibility).toBe("hidden");
    expect(trackEl.dataset.swipeActive).toBeUndefined();
    expect(trackEl.dataset.swipeDirection).toBeUndefined();
    expect(snapshots.at(-1)).toBeNull();
    expect(track.previewDirectionRef.current).toBeNull();
  });

  it("freezes the outgoing page ink once per page", () => {
    act(() => {
      track.captureInkSnapshot();
      track.captureInkSnapshot();
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual({
      pageId: "page-1",
      svg: "<svg data-page='1' />",
    });
  });

  it("captures a fresh snapshot after the page changes", () => {
    act(() => {
      track.captureInkSnapshot();
    });
    selectedPageId = "page-2";
    inkSvg = "<svg data-page='2' />";
    act(() => {
      track.captureInkSnapshot();
    });
    expect(snapshots.at(-1)?.pageId).toBe("page-2");
  });

  it("only flags the snapshot ready for the page it belongs to", () => {
    act(() => {
      track.captureInkSnapshot();
      track.markInkSnapshotReady("page-2");
    });
    expect(trackEl.dataset.inkSnapshotReady).toBeUndefined();
    act(() => {
      track.markInkSnapshotReady("page-1");
    });
    expect(trackEl.dataset.inkSnapshotReady).toBe("true");
  });

  it("resolves a settle animation when the transition lands", async () => {
    let settled = false;
    let pending: Promise<void>;
    act(() => {
      pending = track.animateTo(motion()).then(() => {
        settled = true;
      });
    });
    expect(trackEl.style.transition).toContain("200ms");
    expect(settled).toBe(false);

    await act(async () => {
      track.handleTransitionEnd({
        target: trackEl,
        currentTarget: trackEl,
        propertyName: "transform",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      await pending!;
    });
    expect(settled).toBe(true);
  });

  it("ignores transition events bubbling from a child", async () => {
    let settled = false;
    act(() => {
      void track.animateTo(motion()).then(() => {
        settled = true;
      });
    });
    await act(async () => {
      track.handleTransitionEnd({
        target: document.createElement("span"),
        currentTarget: trackEl,
        propertyName: "transform",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    });
    expect(settled).toBe(false);
  });

  it("settles immediately when there is no distance to travel", async () => {
    act(() => {
      track.writeOffset(-400);
    });
    let settled = false;
    await act(async () => {
      await track.animateTo(motion({ targetOffset: -400 })).then(() => {
        settled = true;
      });
    });
    expect(settled).toBe(true);
    expect(track.offsetRef.current).toBe(-400);
  });

  it("publishes the motion so React can render the neighbouring page", async () => {
    await act(async () => {
      void track.animateTo(motion({ durationMs: 0 }));
    });
    expect(motions.at(-1)?.direction).toBe("next");
    expect(track.motionRef.current?.direction).toBe("next");
  });

  it("drops a queued offset when the animation takes over", () => {
    act(() => {
      track.queueOffset(-50);
      void track.animateTo(motion({ durationMs: 0 }));
    });
    act(() => {
      flushFrames();
    });
    // The stale queued write must not clobber the animation's target.
    expect(track.offsetRef.current).toBe(-400);
  });
});
