import { describe, expect, it } from "vitest";
import {
  getNotebookLivePinchTransform,
  getNotebookPagePanAfterPinch,
} from "@/lib/workspace/notebook-inking";
import { getNotebookViewportLayout } from "@/lib/workspace/notebook-viewport";

describe("notebook pinch zoom release continuity", () => {
  it("keeps an unconstrained page point at the exact release position", () => {
    const frameWidth = 500;
    const frameHeight = 600;
    const startPageWidth = 1_000;
    const startPageHeight = 1_200;
    const anchorFx = 0.5;
    const anchorFy = 0.5;
    const currentCenterX = 260;
    const currentCenterY = 280;

    const live = getNotebookLivePinchTransform({
      anchorFx,
      anchorFy,
      basePanX: -250,
      basePanY: -300,
      currentCenterX,
      currentCenterY,
      frameWidth,
      frameHeight,
      nextZoom: 1.2,
      startCenterX: 250,
      startCenterY: 300,
      startPageHeight,
      startPageWidth,
      startZoom: 1,
    });
    const committed = getNotebookPagePanAfterPinch({
      pinchCenterX: currentCenterX,
      pinchCenterY: currentCenterY,
      frameLeft: 0,
      frameTop: 0,
      anchorFx,
      anchorFy,
      pageWidth: startPageWidth * live.scaleRatio,
      pageHeight: startPageHeight * live.scaleRatio,
      frameWidth,
      frameHeight,
    });

    expect(live).toEqual({ x: -340, y: -440, scaleRatio: 1.2 });
    expect({ x: live.x, y: live.y }).toEqual(committed);
  });

  it("centres an undersized page during the live pinch instead of on release", () => {
    const frameWidth = 500;
    const frameHeight = 600;
    const startPageWidth = 400;
    const startPageHeight = 500;
    const anchorFx = 0.25;
    const anchorFy = 0.3;
    const currentCenterX = 180;
    const currentCenterY = 220;

    const live = getNotebookLivePinchTransform({
      anchorFx,
      anchorFy,
      basePanX: 50,
      basePanY: 50,
      currentCenterX,
      currentCenterY,
      frameWidth,
      frameHeight,
      nextZoom: 0.92,
      startCenterX: 150,
      startCenterY: 200,
      startPageHeight,
      startPageWidth,
      startZoom: 1,
    });
    const committed = getNotebookPagePanAfterPinch({
      pinchCenterX: currentCenterX,
      pinchCenterY: currentCenterY,
      frameLeft: 0,
      frameTop: 0,
      anchorFx,
      anchorFy,
      pageWidth: startPageWidth * live.scaleRatio,
      pageHeight: startPageHeight * live.scaleRatio,
      frameWidth,
      frameHeight,
    });

    expect(live).toEqual({ x: 66, y: 70, scaleRatio: 0.92 });
    expect({ x: live.x, y: live.y }).toEqual(committed);
  });

  it("applies oversized-page edge limits before the fingers are released", () => {
    const frameWidth = 500;
    const frameHeight = 600;
    const startPageWidth = 400;
    const startPageHeight = 500;
    const anchorFx = 0.1;
    const anchorFy = 0.1;
    const currentCenterX = 90;
    const currentCenterY = 100;

    const live = getNotebookLivePinchTransform({
      anchorFx,
      anchorFy,
      basePanX: 50,
      basePanY: 50,
      currentCenterX,
      currentCenterY,
      frameWidth,
      frameHeight,
      nextZoom: 2,
      startCenterX: 90,
      startCenterY: 100,
      startPageHeight,
      startPageWidth,
      startZoom: 1,
    });
    const committed = getNotebookPagePanAfterPinch({
      pinchCenterX: currentCenterX,
      pinchCenterY: currentCenterY,
      frameLeft: 0,
      frameTop: 0,
      anchorFx,
      anchorFy,
      pageWidth: startPageWidth * live.scaleRatio,
      pageHeight: startPageHeight * live.scaleRatio,
      frameWidth,
      frameHeight,
    });

    expect(live).toEqual({ x: 0, y: 0, scaleRatio: 2 });
    expect({ x: live.x, y: live.y }).toEqual(committed);
  });
});

describe("notebook pinch zoom anchoring", () => {
  // A landscape iPad fits the sheet by height, so it stays narrower than the
  // frame until roughly 2x. That used to pin it to the middle of the frame for
  // most of a zoom: the page appeared to zoom into its own centre and only
  // swung towards the fingers once it grew wide enough to be pannable.
  const frameWidth = 1194;
  const frameHeight = 790;
  const fitted = getNotebookViewportLayout({ frameWidth, frameHeight });
  const startPageWidth = fitted.pageSize.width;
  const startPageHeight = fitted.pageSize.height;
  const basePanX = fitted.pageOrigin.x;
  const basePanY = fitted.pageOrigin.y;
  const anchorFx = 0.2;
  const anchorFy = 0.25;
  // Fingers land on the page and stay put, so any movement of the page point
  // beneath them is drift the zoom introduced.
  const centerX = basePanX + anchorFx * startPageWidth;
  const centerY = basePanY + anchorFy * startPageHeight;

  const anchorScreenPositionAt = (nextZoom: number) => {
    const live = getNotebookLivePinchTransform({
      anchorFx,
      anchorFy,
      basePanX,
      basePanY,
      currentCenterX: centerX,
      currentCenterY: centerY,
      frameWidth,
      frameHeight,
      nextZoom,
      startCenterX: centerX,
      startCenterY: centerY,
      startPageHeight,
      startPageWidth,
      startZoom: 1,
    });
    return {
      x: live.x + anchorFx * startPageWidth * live.scaleRatio,
      y: live.y + anchorFy * startPageHeight * live.scaleRatio,
    };
  };

  it("holds the pinched page point under the fingers through an ordinary zoom", () => {
    for (const zoom of [1, 1.1, 1.25, 1.5]) {
      expect(Math.abs(anchorScreenPositionAt(zoom).x - centerX)).toBeLessThan(
        12
      );
    }
  });

  it("gives up the anchor only as far as covering the frame demands", () => {
    // Once the sheet is wider than the frame it has to keep the frame covered,
    // and that is the only thing allowed to move the anchor: the page point
    // lands on the reachable position nearest the fingers, nothing further.
    for (const zoom of [2.5, 3, 3.5, 4]) {
      const pageWidth = startPageWidth * zoom;
      const nearestReachable = Math.min(
        Math.max(centerX, frameWidth - (1 - anchorFx) * pageWidth),
        anchorFx * pageWidth
      );
      expect(anchorScreenPositionAt(zoom).x).toBeCloseTo(nearestReachable, 6);
    }
  });

  it("moves the anchor continuously as the sheet grows to fill the frame", () => {
    const fillZoom = frameWidth / startPageWidth;
    const before = anchorScreenPositionAt(fillZoom - 0.001).x;
    const after = anchorScreenPositionAt(fillZoom + 0.001).x;

    expect(Math.abs(after - before)).toBeLessThan(1);
  });
});
