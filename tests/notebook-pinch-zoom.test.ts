import { describe, expect, it } from "vitest";
import {
  getNotebookLivePinchTransform,
  getNotebookPagePanAfterPinch,
} from "@/lib/workspace/notebook-inking";

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
