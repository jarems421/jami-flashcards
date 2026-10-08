import { describe, expect, it, vi } from "vitest";
import type { Editor as JsDrawEditor } from "js-draw";
import {
  getNotebookLiveInkGrownRegion,
  getNotebookLiveInkPixelRatio,
  getNotebookLiveInkPixelSnap,
  getNotebookLiveInkRegion,
  getNotebookLiveInkStartRegion,
  notebookLiveInkNeedsRoom,
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
    // A 5K or Studio Display at 2x, page fully on screen: drawn at full density,
    // not softer than the page canvas beneath it.
    expect(
      getNotebookLiveInkPixelRatio({ width: 2560, height: 1440, devicePixelRatio: 2 })
    ).toBe(2);
  });

  it("puts the canvas's corner on a device pixel, so live ink is never resampled", () => {
    // A page centred on a half pixel at 1x moves half a pixel; at 2x a quarter
    // CSS pixel is half a device pixel.
    expect(getNotebookLiveInkPixelSnap(100.5, 1)).toBeCloseTo(0.5);
    expect(Math.abs(getNotebookLiveInkPixelSnap(100.25, 2))).toBeCloseTo(0.25);
    // Already aligned, or at a fractional density, it lands on a whole device pixel.
    expect(getNotebookLiveInkPixelSnap(64, 2)).toBe(0);
    const origin = 37.3;
    const snapped = (origin + getNotebookLiveInkPixelSnap(origin, 1.25)) * 1.25;
    expect(snapped).toBeCloseTo(Math.round(snapped), 9);
    expect(getNotebookLiveInkPixelSnap(Number.NaN, 2)).toBe(0);
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
  const wetCanvas = {
    width: 3000,
    height: 4000,
    style: {
      display: "",
      removeProperty(name: string) {
        if (name === "display") this.display = "";
      },
    },
  };
  const originalCtx = fakeContext(wetCanvas);
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
    rerender: vi.fn(),
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
    wetCanvas,
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

  it("puts js-draw's idle wet canvas away while fast ink is on", () => {
    const fake = fakeEditor();
    const liveInk = installNotebookLiveInk({
      editor: fake.editor,
      jsDraw: fake.jsDraw,
      canvas: fake.liveCanvas,
    });
    liveInk?.setParked(true);
    expect(fake.wetCanvas.width).toBe(1);
    expect(fake.wetCanvas.height).toBe(1);
    expect(fake.wetCanvas.style.display).toBe("none");

    // A stroke that could not go live still reaches the page, by a repaint.
    fake.display.flatten();
    expect(fake.originalFlatten).not.toHaveBeenCalled();
    expect(fake.editor.queueRerender).toHaveBeenCalledTimes(1);

    // Turned off, js-draw is asked to size it again.
    liveInk?.setParked(false);
    expect(fake.wetCanvas.style.display).toBe("");
    expect(fake.editor.rerender).toHaveBeenCalledTimes(1);
    fake.display.flatten();
    expect(fake.originalFlatten).toHaveBeenCalledTimes(1);
  });

  it("does not repaint a parked canvas back while the editor is torn down", () => {
    const fake = fakeEditor();
    const liveInk = installNotebookLiveInk({
      editor: fake.editor,
      jsDraw: fake.jsDraw,
      canvas: fake.liveCanvas,
    });
    liveInk?.setParked(true);
    liveInk?.dispose();
    expect(fake.wetCanvas.style.display).toBe("");
    expect(fake.editor.rerender).not.toHaveBeenCalled();
  });

  it("sizes the live canvas ahead of the stroke, so the pointerdown only moves it", () => {
    const fake = fakeEditor();
    const liveInk = installNotebookLiveInk({
      editor: fake.editor,
      jsDraw: fake.jsDraw,
      canvas: fake.liveCanvas,
    });
    liveInk?.prepare(strokeInput);
    // The square a stroke starts in: 256 either side of the pen and a grid step, at 2x.
    expect(fake.liveCanvas.width).toBe(1152);
    expect(fake.liveCanvas.height).toBe(1152);
    expect(liveInk?.active).toBe(false);
    expect(fake.wet.ctx).toBe(asContext(fake.originalCtx));

    fake.liveSpies.setTransform.mockClear();
    liveInk?.begin(penDown);
    // Resizing is what sets the scale: the prepared canvas was moved, not made again.
    expect(fake.liveSpies.setTransform).not.toHaveBeenCalled();
    expect(fake.liveCanvas.style.left).toBe("192px");
    expect(liveInk?.active).toBe(true);
  });
});

/** The pen landing at (400, 500) on screen: (500, 460) on the surface. */
const penDown = { ...strokeInput, pointer: { clientX: 400, clientY: 500 } };

describe("a live canvas that follows the stroke", () => {
  function begin() {
    const fake = fakeEditor();
    const liveInk = installNotebookLiveInk({ editor: fake.editor, jsDraw: fake.jsDraw, canvas: fake.liveCanvas });
    if (!liveInk) throw new Error("not installed");
    liveInk.begin(penDown);
    return { fake, liveInk };
  }

  it("starts as a square around the pen, not the whole screen", () => {
    const { fake } = begin();
    expect(fake.liveCanvas.style.left).toBe("192px");
    expect(fake.liveCanvas.style.top).toBe("192px");
    expect(fake.liveCanvas.style.width).toBe("576px");
    expect(fake.liveCanvas.style.height).toBe("576px");
    // A third of what covering the screen (896 x 1152) would hold.
    expect(fake.liveCanvas.width * fake.liveCanvas.height).toBe(1152 * 1152);
    // js-draw's region starts 160 into the surface; the canvas 192.
    expect(fake.wet.setTransform).toHaveBeenLastCalledWith({
      offset: { x: -32, y: -192 },
      after: fake.viewport.canvasToScreenTransform,
    });
  });

  it("only wipes between frames while the stroke has room", () => {
    const { fake } = begin();
    fake.wet.ctx.moveTo(200, 200);
    fake.wet.ctx.lineTo(260, 240);
    fake.wet.ctx.stroke();
    fake.wet.clear();
    expect(fake.liveCanvas.style.width).toBe("576px");
    expect(fake.liveSpies.clearRect).toHaveBeenCalled();
  });

  it("grows before the next frame once the stroke nears an edge, and keeps inside the screen", () => {
    const { fake } = begin();
    fake.liveSpies.setTransform.mockClear();
    fake.wet.ctx.moveTo(500, 100);
    fake.wet.ctx.lineTo(540, 120);
    fake.wet.ctx.stroke();
    fake.wet.clear();

    // Out to the screen's right edge (960) and up to its top, from the corner it had.
    expect(fake.liveCanvas.style.left).toBe("192px");
    expect(fake.liveCanvas.style.top).toBe("0px");
    expect(fake.liveCanvas.style.width).toBe("768px");
    expect(fake.liveCanvas.style.height).toBe("768px");
    // Reallocated at the screen's density, and js-draw follows the canvas's new corner.
    expect(fake.liveSpies.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(fake.wet.setTransform).toHaveBeenLastCalledWith({
      offset: { x: -32, y: 0 },
      after: fake.viewport.canvasToScreenTransform,
    });
  });

  it("starts the next stroke small again, wherever the last one grew to", () => {
    const { fake, liveInk } = begin();
    fake.wet.ctx.moveTo(500, 100);
    fake.wet.ctx.lineTo(540, 120);
    fake.wet.ctx.stroke();
    fake.wet.clear();
    liveInk.end();

    liveInk.begin({ ...strokeInput, pointer: { clientX: 200, clientY: 1000 } });
    expect(fake.liveCanvas.style.width).toBe("576px");
    expect(fake.liveCanvas.style.height).toBe("576px");
  });
});

describe("where the live canvas goes", () => {
  const visible = { left: 64, top: 0, width: 896, height: 1152 };

  it("keeps the starting square whole and on screen at the edges", () => {
    expect(getNotebookLiveInkStartRegion({ visible, x: 900, y: 1100 })).toEqual({ left: 384, top: 576, width: 576, height: 576 });
    expect(getNotebookLiveInkStartRegion({ visible, x: 0, y: 0 })).toEqual({ left: 64, top: 0, width: 576, height: 576 });
    // A screen smaller than the square is covered whole.
    expect(getNotebookLiveInkStartRegion({ visible: { left: 0, top: 0, width: 400, height: 300 }, x: 50, y: 50 })).toEqual({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
    });
  });

  it("asks for room only towards a side that can still grow", () => {
    const region = { left: 64, top: 192, width: 576, height: 576 };
    // Near the left, which is already the screen's edge.
    expect(notebookLiveInkNeedsRoom({ drawn: { left: 70, top: 400, right: 100, bottom: 420 }, region, visible })).toBe(false);
    // Near the bottom, which is not.
    expect(notebookLiveInkNeedsRoom({ drawn: { left: 300, top: 700, right: 320, bottom: 720 }, region, visible })).toBe(true);
  });

  it("only ever grows, by whole grid steps, within the screen", () => {
    const region = { left: 192, top: 192, width: 576, height: 576 };
    const grown = getNotebookLiveInkGrownRegion({ region, visible, drawn: { left: 300, top: 700, right: 320, bottom: 720 } });
    expect(grown).toEqual({ left: 0 + 64, top: 192, width: 768 - 64, height: 1024 - 192 });
    expect(grown.left % 64).toBe(0);
    expect(grown.left).toBeGreaterThanOrEqual(visible.left);
  });
});

