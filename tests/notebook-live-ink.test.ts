import { describe, expect, it, vi } from "vitest";
import type { Editor as JsDrawEditor } from "js-draw";
import {
  getNotebookLiveInkPixelRatio,
  getNotebookLiveInkRegion,
  installNotebookLiveInk,
  NotebookLiveInkDirtyRegion,
  sameNotebookLiveInkRegion,
} from "@/lib/workspace/notebook-live-ink";

function fakeContext(canvas: { width: number; height: number }) {
  return {
    canvas,
    lineWidth: 1,
    lineJoin: "round" as CanvasLineJoin,
    miterLimit: 10,
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    drawImage: vi.fn(),
    transform: vi.fn(),
  };
}

type FakeContext = ReturnType<typeof fakeContext>;

function asContext(ctx: FakeContext) {
  return ctx as unknown as CanvasRenderingContext2D;
}

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height } as DOMRectReadOnly;
}

describe("fast live ink geometry", () => {
  it("covers only the part of the page that is on screen, snapped to the grid", () => {
    // A zoomed page pushed up and to the left of an 820x1180 screen.
    expect(
      getNotebookLiveInkRegion({
        surfaceLeft: -1000,
        surfaceTop: -700,
        surfaceWidth: 3264,
        surfaceHeight: 4496,
        viewportWidth: 820,
        viewportHeight: 1180,
      })
    ).toEqual({ left: 960, top: 640, width: 896, height: 1280 });

    // A fitted page smaller than the screen is covered exactly.
    expect(
      getNotebookLiveInkRegion({
        surfaceLeft: 2,
        surfaceTop: 56,
        surfaceWidth: 816,
        surfaceHeight: 1124,
        viewportWidth: 820,
        viewportHeight: 1180,
      })
    ).toEqual({ left: 0, top: 0, width: 816, height: 1124 });

    // Off screen entirely.
    expect(
      getNotebookLiveInkRegion({
        surfaceLeft: 900,
        surfaceTop: 0,
        surfaceWidth: 800,
        surfaceHeight: 1000,
        viewportWidth: 820,
        viewportHeight: 1180,
      })
    ).toBeNull();
  });

  it("keeps the screen's density unless the canvas would be huge", () => {
    expect(
      getNotebookLiveInkPixelRatio({ width: 820, height: 1180, devicePixelRatio: 2 })
    ).toBe(2);
    const capped = getNotebookLiveInkPixelRatio({
      width: 2560,
      height: 1440,
      devicePixelRatio: 2,
      maxPixels: 8_000_000,
    });
    expect(capped).toBeLessThan(2);
    expect(2560 * 1440 * capped * capped).toBeCloseTo(8_000_000, -2);
    expect(
      getNotebookLiveInkPixelRatio({ width: 10, height: 10, devicePixelRatio: Number.NaN })
    ).toBe(1);
  });

  it("compares regions by value", () => {
    const region = { left: 0, top: 64, width: 128, height: 256 };
    expect(sameNotebookLiveInkRegion(region, { ...region })).toBe(true);
    expect(sameNotebookLiveInkRegion(region, { ...region, top: 0 })).toBe(false);
    expect(sameNotebookLiveInkRegion(null, region)).toBe(false);
  });
});

describe("fast live ink dirty region", () => {
  it("wipes only the box around what was drawn, stroke width included", () => {
    const canvas = { width: 1600, height: 2400 };
    const ctx = fakeContext(canvas);
    // The tracker wraps these in place; keep the mocks themselves.
    const spies = { ...ctx };
    const tracker = new NotebookLiveInkDirtyRegion(asContext(ctx));
    expect(tracker.dirty).toBe(false);

    const drawing = asContext(ctx);
    drawing.moveTo(10, 10);
    drawing.bezierCurveTo(12, 40, 30, 5, 20, 30);
    drawing.lineWidth = 4;
    drawing.stroke();
    expect(tracker.dirty).toBe(true);
    // The drawing still reaches the real context.
    expect(spies.bezierCurveTo).toHaveBeenCalledWith(12, 40, 30, 5, 20, 30);

    // Box 10..30 x 5..40, grown by half the width (2) and a 2px margin, at 2x.
    expect(tracker.getWipeRect(2)).toEqual({ x: 12, y: 2, width: 56, height: 86 });

    tracker.wipe(2);
    expect(spies.clearRect).toHaveBeenCalledWith(12, 2, 56, 86);
    // The wipe resets the transform to do its work without being counted.
    expect(tracker.dirty).toBe(false);
    expect(tracker.getWipeRect(2)).toBeNull();
  });

  it("wipes the whole canvas after anything it cannot bound", () => {
    const canvas = { width: 800, height: 600 };
    const ctx = fakeContext(canvas);
    const tracker = new NotebookLiveInkDirtyRegion(asContext(ctx));
    asContext(ctx).transform(2, 0, 0, 2, 5, 5);
    expect(tracker.getWipeRect(1)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    tracker.wipe(1);
    expect(tracker.dirty).toBe(false);
  });

  it("does not count its own sizing as drawing, and unwraps on dispose", () => {
    const ctx = fakeContext({ width: 100, height: 100 });
    const spies = { ...ctx };
    const tracker = new NotebookLiveInkDirtyRegion(asContext(ctx));
    tracker.setScale(2);
    expect(spies.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(tracker.dirty).toBe(false);

    tracker.dispose();
    expect(ctx.lineTo).toBe(spies.lineTo);
  });
});

function fakeEditor(options: { withCommitHook?: boolean } = {}) {
  const originalCtx = fakeContext({ width: 3000, height: 4000 });
  const originalClear = vi.fn();
  const wet = {
    ctx: asContext(originalCtx),
    clear: originalClear,
    setTransform: vi.fn(),
  };
  const dry = { name: "dry renderer" };
  const originalFlatten = vi.fn();
  const originalAdd = vi.fn();
  const display = {
    getWetInkRenderer: () => wet,
    getDryInkRenderer: () => dry,
    flatten: originalFlatten,
  };
  const image: { addComponentDirectly?: (component: unknown) => void } =
    options.withCommitHook === false ? {} : { addComponentDirectly: originalAdd };
  const viewport = {
    canvasToScreenTransform: { name: "viewport transform" },
    visibleRect: { name: "visible rect" },
  };
  const editor = {
    display,
    image,
    viewport,
    queueRerender: vi.fn(),
  } as unknown as JsDrawEditor;
  const jsDraw = {
    Vec2: { of: (x: number, y: number) => ({ x, y }) },
    Mat33: {
      translation: (offset: { x: number; y: number }) => ({
        rightMul: (after: unknown) => ({ offset, after }),
      }),
    },
  } as never;
  const liveCanvasState = { width: 300, height: 150 };
  const liveCtx = fakeContext(liveCanvasState);
  // The live-ink tracker wraps these in place; keep the mocks themselves.
  const liveSpies = { ...liveCtx };
  const liveCanvas = Object.assign(liveCanvasState, {
    style: {} as Record<string, string>,
    getContext: () => liveCtx,
  }) as unknown as HTMLCanvasElement;
  return {
    display,
    dry,
    editor,
    image,
    jsDraw,
    liveCanvas,
    liveCtx,
    liveSpies,
    originalAdd,
    originalClear,
    originalCtx,
    originalFlatten,
    viewport,
    wet,
  };
}

const strokeInput = {
  surfaceRect: rect(-100, 40, 2000, 2800),
  regionRect: rect(60, 40, 1200, 1600),
  viewportWidth: 820,
  viewportHeight: 1180,
  devicePixelRatio: 2,
};

describe("installNotebookLiveInk", () => {
  it("draws a live stroke on its own canvas and hands it over at the lift", () => {
    const fake = fakeEditor();
    const liveInk = installNotebookLiveInk({
      editor: fake.editor,
      jsDraw: fake.jsDraw,
      canvas: fake.liveCanvas,
    });
    expect(liveInk).not.toBeNull();
    if (!liveInk) return;

    expect(liveInk.begin(strokeInput)).toBe(true);
    expect(liveInk.active).toBe(true);
    // Only the on-screen part of the page, at the screen's density.
    expect(fake.liveCanvas.style.left).toBe("64px");
    expect(fake.liveCanvas.style.width).toBe("896px");
    expect(fake.liveCanvas.width).toBe(1792);
    expect(fake.liveCanvas.height).toBe(2304);
    expect(fake.liveSpies.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);

    // js-draw's wet renderer now draws here, shifted from its region's origin
    // to the live canvas's.
    expect(fake.wet.ctx).toBe(fake.liveCtx);
    expect(fake.wet.setTransform).toHaveBeenLastCalledWith({
      offset: { x: 96, y: 0 },
      after: fake.viewport.canvasToScreenTransform,
    });

    // A preview frame: js-draw wipes, then draws.
    fake.wet.ctx.moveTo(10, 10);
    fake.wet.ctx.lineTo(20, 30);
    fake.wet.ctx.stroke();
    fake.wet.clear();
    expect(fake.originalClear).not.toHaveBeenCalled();
    // 10..20 x 10..30, grown by half the 1px line and a 2px margin, at 2x.
    expect(fake.liveSpies.clearRect).toHaveBeenLastCalledWith(15, 15, 30, 50);

    // The lift: js-draw commits the stroke, then flattens.
    const committed = { render: vi.fn() };
    fake.image.addComponentDirectly?.(committed);
    expect(fake.originalAdd).toHaveBeenCalledWith(committed);
    fake.display.flatten();
    expect(fake.originalFlatten).not.toHaveBeenCalled();
    expect(committed.render).toHaveBeenCalledWith(
      fake.dry,
      fake.viewport.visibleRect
    );

    liveInk.end();
    expect(liveInk.active).toBe(false);
    expect(fake.wet.ctx).toBe(asContext(fake.originalCtx));
    expect(fake.wet.setTransform).toHaveBeenLastCalledWith(null);

    // Outside a live stroke js-draw's own behaviour is untouched.
    fake.wet.clear();
    expect(fake.originalClear).toHaveBeenCalledTimes(1);
    fake.display.flatten();
    expect(fake.originalFlatten).toHaveBeenCalledTimes(1);
  });

  it("repaints the page if a commit arrives without a component to draw", () => {
    const fake = fakeEditor();
    const liveInk = installNotebookLiveInk({
      editor: fake.editor,
      jsDraw: fake.jsDraw,
      canvas: fake.liveCanvas,
    });
    liveInk?.begin(strokeInput);
    fake.display.flatten();
    expect(fake.editor.queueRerender).toHaveBeenCalledTimes(1);
  });

  it("reuses the canvas for a stroke in the same place", () => {
    const fake = fakeEditor();
    const liveInk = installNotebookLiveInk({
      editor: fake.editor,
      jsDraw: fake.jsDraw,
      canvas: fake.liveCanvas,
    });
    liveInk?.begin(strokeInput);
    liveInk?.end();
    fake.liveSpies.setTransform.mockClear();
    liveInk?.begin(strokeInput);
    // Resizing is what sets the scale; the same region is not resized.
    expect(fake.liveSpies.setTransform).not.toHaveBeenCalled();
  });

  it("puts every js-draw method back when disposed", () => {
    const fake = fakeEditor();
    const liveInk = installNotebookLiveInk({
      editor: fake.editor,
      jsDraw: fake.jsDraw,
      canvas: fake.liveCanvas,
    });
    liveInk?.begin(strokeInput);
    liveInk?.dispose();
    expect(fake.wet.clear).toBe(fake.originalClear);
    expect(fake.display.flatten).toBe(fake.originalFlatten);
    expect(fake.image.addComponentDirectly).toBe(fake.originalAdd);
    expect(fake.wet.ctx).toBe(asContext(fake.originalCtx));
  });

  it("stays out of the way when js-draw lacks a hook it needs", () => {
    const fake = fakeEditor({ withCommitHook: false });
    expect(
      installNotebookLiveInk({
        editor: fake.editor,
        jsDraw: fake.jsDraw,
        canvas: fake.liveCanvas,
      })
    ).toBeNull();
    expect(fake.wet.clear).toBe(fake.originalClear);
  });
});
