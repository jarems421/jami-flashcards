/**
 * Every canvas the renderer makes comes from here, so the stats can say how
 * many there are, how much memory they hold and how big the biggest is: the
 * figures the memory gate (96 MB, no canvas over 4 MP) is checked against.
 */

import { inkCanvasBytes, type InkDeviceRect } from "@/lib/ink/render-plan";
import type { InkRendererStats } from "@/lib/ink-dom/stats";

export type InkCanvas = {
  element: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Backing size in device pixels; never changed after creation. */
  width: number;
  height: number;
};

export class InkCanvasLedger {
  constructor(
    private readonly doc: Document,
    private readonly stats: InkRendererStats
  ) {}

  /**
   * A new canvas of exactly this backing size, absolutely positioned and
   * ignoring the pointer. Null if the browser will not give a 2D context
   * (out of canvas memory), in which case nothing is counted.
   */
  create(width: number, height: number): InkCanvas | null {
    const element = this.doc.createElement("canvas");
    element.width = width;
    element.height = height;
    const ctx = element.getContext("2d");
    if (!ctx) {
      element.width = 0;
      element.height = 0;
      return null;
    }
    const style = element.style;
    style.position = "absolute";
    style.display = "block";
    style.pointerEvents = "none";
    const stats = this.stats;
    stats.canvasAllocations += 1;
    stats.canvasBytes += inkCanvasBytes(width, height);
    stats.peakCanvasBytes = Math.max(stats.peakCanvasBytes, stats.canvasBytes);
    stats.largestCanvasPixels = Math.max(stats.largestCanvasPixels, width * height);
    return { element, ctx, width, height };
  }

  /** Frees the backing store at once (rather than at garbage collection) and detaches it. */
  destroy(canvas: InkCanvas): void {
    canvas.element.remove();
    canvas.element.width = 0;
    canvas.element.height = 0;
    this.stats.canvasBytes -= inkCanvasBytes(canvas.width, canvas.height);
  }
}

/** Places a canvas at a sheet device-pixel position, sized one canvas pixel to one device pixel. */
export function placeInkCanvas(canvas: InkCanvas, x: number, y: number, devicePixelRatio: number): void {
  const style = canvas.element.style;
  style.left = `${x / devicePixelRatio}px`;
  style.top = `${y / devicePixelRatio}px`;
  style.width = `${canvas.width / devicePixelRatio}px`;
  style.height = `${canvas.height / devicePixelRatio}px`;
  style.visibility = "";
}

/** Wipes a whole canvas, whatever transform it was left with. */
export function clearInkCanvas(canvas: InkCanvas): void {
  canvas.ctx.setTransform(1, 0, 0, 1, 0, 0);
  canvas.ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Copies a region, in canvas pixels, from one canvas to the same place in
 * another of the same size, exactly: the region is cleared, then drawn one
 * pixel to one pixel, so translucent pixels arrive unchanged.
 */
export function copyInkCanvasRegion(from: InkCanvas, to: InkCanvas, region: InkDeviceRect): void {
  const ctx = to.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(region.x, region.y, region.width, region.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(from.element, region.x, region.y, region.width, region.height, region.x, region.y, region.width, region.height);
}
