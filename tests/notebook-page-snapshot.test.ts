import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOTEBOOK_PAGE_SNAPSHOT_FALLBACK_SCALE,
  NOTEBOOK_PAGE_SNAPSHOT_SCALE,
  getNotebookSnapshotContainRect,
  getNotebookSnapshotPaperPattern,
  getNotebookSnapshotTypedText,
  renderNotebookPageSnapshot,
  wrapNotebookSnapshotText,
} from "@/lib/workspace/notebook-page-snapshot";
import type { NotebookTextBlock } from "@/lib/workspace/notebooks";

type CanvasCall = { name: string; values: unknown[] };

function makeCanvasHarness(options?: {
  encodedSize?(width: number): number;
  webpSupported?: boolean;
}) {
  const canvases: Array<{ calls: CanvasCall[]; height: number; width: number }> = [];
  const encodedSize = options?.encodedSize ?? (() => 16);
  const webpSupported = options?.webpSupported ?? true;

  const documentStub = {
    createElement(tagName: string) {
      expect(tagName).toBe("canvas");
      const record = { calls: [] as CanvasCall[], height: 0, width: 0 };
      const context = new Proxy(
        {
          measureText(value: string) {
            return { width: value.length * 10 };
          },
        },
        {
          get(target, property) {
            if (property in target) {
              return target[property as keyof typeof target];
            }
            return (...values: unknown[]) => {
              record.calls.push({ name: String(property), values });
            };
          },
          set(target, property, value) {
            Object.assign(target, { [property]: value });
            return true;
          },
        }
      );
      const canvas = {
        get height() {
          return record.height;
        },
        set height(value: number) {
          record.height = value;
        },
        get width() {
          return record.width;
        },
        set width(value: number) {
          record.width = value;
        },
        getContext: () => context,
        toBlob(
          callback: (blob: Blob | null) => void,
          type: string
        ) {
          if (type === "image/webp" && !webpSupported) {
            callback(null);
            return;
          }
          callback(
            new Blob([new Uint8Array(encodedSize(record.width))], {
              type,
            })
          );
        },
      };
      canvases.push(record);
      return canvas;
    },
  };
  vi.stubGlobal("document", documentStub);
  return canvases;
}

const textBlocks: NotebookTextBlock[] = [
  {
    id: "later",
    x: 300,
    y: 240,
    width: 260,
    height: 120,
    text: "Second idea",
    outlineVisible: false,
  },
  {
    id: "first",
    x: 80,
    y: 80,
    width: 320,
    height: 160,
    text: "  First idea  ",
    outlineVisible: true,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notebook page snapshot geometry", () => {
  it("centres contain-fitted backgrounds without changing their aspect ratio", () => {
    expect(
      getNotebookSnapshotContainRect({
        containerWidth: 900,
        containerHeight: 1240,
        sourceWidth: 1600,
        sourceHeight: 900,
      })
    ).toEqual({
      x: 0,
      y: 366.875,
      width: 900,
      height: 506.25,
    });
  });

  it("matches the notebook paper spacing and colours", () => {
    const lined = getNotebookSnapshotPaperPattern("white", "lined");
    expect(lined.backgroundColor).toBe("#ffffff");
    expect(lined.lineColor).toBe("rgba(30, 41, 59, 0.14)");
    expect(lined.horizontalLines.slice(0, 3)).toEqual([40, 80, 120]);
    expect(lined.verticalLines).toEqual([]);

    const grid = getNotebookSnapshotPaperPattern("black", "grid", 81, 81);
    expect(grid.backgroundColor).toBe("#080a10");
    expect(grid.horizontalLines).toEqual([0.5, 40.5, 80.5]);
    expect(grid.verticalLines).toEqual([0.5, 40.5, 80.5]);

    const fullPageGrid = getNotebookSnapshotPaperPattern("white", "grid");
    expect(fullPageGrid.verticalLines[0]).toBe(10);
    expect(fullPageGrid.verticalLines.at(-1)).toBe(890);
    expect(fullPageGrid.horizontalLines[0]).toBe(0);
    expect(fullPageGrid.horizontalLines.at(-1)).toBe(1240);

    const dotted = getNotebookSnapshotPaperPattern("white", "dot", 43, 43);
    expect(dotted.dotCenters).toEqual([
      { x: 14, y: 14 },
      { x: 42, y: 14 },
      { x: 14, y: 42 },
      { x: 42, y: 42 },
    ]);
  });

  it("keeps typed context in page reading order and wraps long text", () => {
    expect(getNotebookSnapshotTypedText(textBlocks)).toBe(
      "First idea\n\nSecond idea"
    );
    expect(
      wrapNotebookSnapshotText("alpha beta verylongword", 50, (value) =>
        value.length * 10
      )
    ).toEqual(["alpha", "beta", "veryl", "ongwo", "rd"]);
  });
});

describe("renderNotebookPageSnapshot", () => {
  it("composes a two-times WebP snapshot and returns exact typed text", async () => {
    const canvases = makeCanvasHarness();
    const result = await renderNotebookPageSnapshot({
      pageColor: "white",
      pageStyle: "plain",
      inkSvg: "",
      textBlocks,
    });

    expect(result).toMatchObject({
      width: 1800,
      height: 2480,
      mimeType: "image/webp",
      scale: NOTEBOOK_PAGE_SNAPSHOT_SCALE,
      typedText: "First idea\n\nSecond idea",
      encodedBytes: 16,
    });
    expect(canvases).toHaveLength(1);
    expect(canvases[0].calls.map((call) => call.name)).toEqual(
      expect.arrayContaining(["setTransform", "fillRect", "fillText"])
    );
  });

  it("uses PNG when WebP encoding is unavailable", async () => {
    makeCanvasHarness({ webpSupported: false });
    const result = await renderNotebookPageSnapshot({
      pageColor: "black",
      pageStyle: "grid",
      inkSvg: "",
      textBlocks: [],
    });

    expect(result.mimeType).toBe("image/png");
    expect(result.scale).toBe(NOTEBOOK_PAGE_SNAPSHOT_SCALE);
  });

  it("rerenders at 1.6 times when the primary image exceeds the request budget", async () => {
    const canvases = makeCanvasHarness({
      encodedSize: (width) => (width === 1800 ? 32 : 8),
    });
    const result = await renderNotebookPageSnapshot({
      pageColor: "white",
      pageStyle: "lined",
      inkSvg: "",
      textBlocks: [],
      maxEncodedBytes: 16,
    });

    expect(result.scale).toBe(NOTEBOOK_PAGE_SNAPSHOT_FALLBACK_SCALE);
    expect(result.width).toBe(1440);
    expect(result.height).toBe(1984);
    expect(result.encodedBytes).toBe(8);
    expect(canvases).toHaveLength(2);
  });
});
