import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";

export const NOTEBOOK_VIEWPORT_MIN_ZOOM = 0.92;
export const NOTEBOOK_VIEWPORT_MAX_ZOOM = 4;
export const NOTEBOOK_VIEWPORT_COMPACT_MAX_WIDTH = 767;
export const NOTEBOOK_VIEWPORT_COMPACT_INSET = 12;
export const NOTEBOOK_VIEWPORT_REGULAR_INSET = 16;
export const NOTEBOOK_VIEWPORT_LANDSCAPE_INSET = 8;
export const NOTEBOOK_VIEWPORT_COMPACT_SWIPE_GAP = 24;
export const NOTEBOOK_VIEWPORT_SWIPE_GAP = 48;

export type NotebookViewportSize = {
  width: number;
  height: number;
};

export type NotebookViewportPoint = {
  x: number;
  y: number;
};

export type NotebookViewportPanBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type NotebookViewportLayout = {
  frameSize: NotebookViewportSize;
  logicalPageSize: NotebookViewportSize;
  inset: number;
  availableSize: NotebookViewportSize;
  fitScale: number;
  fitSize: NotebookViewportSize;
  fitOrigin: NotebookViewportPoint;
  zoom: number;
  pageSize: NotebookViewportSize;
  pageOrigin: NotebookViewportPoint;
  panBounds: NotebookViewportPanBounds;
  swipeGap: number;
  swipeTravel: number;
};

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Zoom above which the sheet counts as zoomed in rather than fitted. Shared so
 * pan bounds and drag intent agree on when the reader has left the fitted view.
 */
export const NOTEBOOK_VIEWPORT_FIT_ZOOM_EPSILON = 1.0001;

export function isNotebookViewportZoomedIn(zoom: number | undefined) {
  return (
    typeof zoom === "number" &&
    Number.isFinite(zoom) &&
    zoom > NOTEBOOK_VIEWPORT_FIT_ZOOM_EPSILON
  );
}

export function clampNotebookViewportZoom(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(
    NOTEBOOK_VIEWPORT_MIN_ZOOM,
    Math.min(NOTEBOOK_VIEWPORT_MAX_ZOOM, value)
  );
}

export function getNotebookViewportInset(
  frameWidth: number,
  frameHeight?: number
) {
  const width = finiteNonNegative(frameWidth);
  const height = finiteNonNegative(frameHeight ?? 0);
  if (width <= NOTEBOOK_VIEWPORT_COMPACT_MAX_WIDTH) {
    return NOTEBOOK_VIEWPORT_COMPACT_INSET;
  }
  return height > 0 && width > height
    ? NOTEBOOK_VIEWPORT_LANDSCAPE_INSET
    : NOTEBOOK_VIEWPORT_REGULAR_INSET;
}

export function getNotebookViewportSwipeGap(frameWidth: number) {
  return finiteNonNegative(frameWidth) <= NOTEBOOK_VIEWPORT_COMPACT_MAX_WIDTH
    ? NOTEBOOK_VIEWPORT_COMPACT_SWIPE_GAP
    : NOTEBOOK_VIEWPORT_SWIPE_GAP;
}

export function getNotebookViewportSwipeTravel(input: {
  frameWidth: number;
  pageWidth: number;
  swipeGap: number;
}) {
  const frameWidth = finiteNonNegative(input.frameWidth);
  const pageWidth = finiteNonNegative(input.pageWidth);
  const swipeGap = finiteNonNegative(input.swipeGap);
  const centredWorkspaceGap = Math.max(0, (frameWidth - pageWidth) / 2);

  // Place each adjacent sheet just beyond the nearest viewport edge. Wide
  // workspaces therefore remain single-page surfaces instead of exposing
  // several page-width-spaced carousel slots at once.
  return pageWidth + Math.max(swipeGap, centredWorkspaceGap);
}

export function getNotebookViewportFit(input: {
  frameWidth: number;
  frameHeight: number;
  pageWidth?: number;
  pageHeight?: number;
  inset?: number;
}): NotebookViewportSize {
  const frameWidth = finiteNonNegative(input.frameWidth);
  const frameHeight = finiteNonNegative(input.frameHeight);
  const pageWidth = finiteNonNegative(
    input.pageWidth ?? NOTEBOOK_PAGE_COORDINATE_WIDTH
  );
  const pageHeight = finiteNonNegative(
    input.pageHeight ?? NOTEBOOK_PAGE_COORDINATE_HEIGHT
  );
  const inset = finiteNonNegative(
    input.inset ?? getNotebookViewportInset(frameWidth, frameHeight)
  );
  const availableWidth = Math.max(0, frameWidth - inset * 2);
  const availableHeight = Math.max(0, frameHeight - inset * 2);

  if (
    availableWidth === 0 ||
    availableHeight === 0 ||
    pageWidth === 0 ||
    pageHeight === 0
  ) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(
    availableWidth / pageWidth,
    availableHeight / pageHeight
  );
  return {
    width: pageWidth * scale,
    height: pageHeight * scale,
  };
}

export function getNotebookViewportPanBounds(input: {
  pageWidth: number;
  pageHeight: number;
  frameWidth: number;
  frameHeight: number;
  /**
   * Live zoom. An axis narrower than the frame used to be pinned to the middle
   * of it at every zoom, which is why a pinch appeared to zoom into the centre
   * of the page and only swung towards the fingers near the end: a landscape
   * sheet is narrower than the frame until roughly 2x, so the anchor was
   * discarded for most of the gesture and handed back abruptly.
   *
   * The spare room is now released gradually. At fit zoom the sheet is still
   * pinned to the centre -- so it rests centred and horizontal drags stay page
   * swipes -- and the reachable range opens out as the axis grows towards
   * filling the frame, meeting the covered-frame range exactly when it does.
   */
  zoom?: number;
}): NotebookViewportPanBounds {
  const pageWidth = finiteNonNegative(input.pageWidth);
  const pageHeight = finiteNonNegative(input.pageHeight);
  const frameWidth = finiteNonNegative(input.frameWidth);
  const frameHeight = finiteNonNegative(input.frameHeight);
  const zoomedIn = isNotebookViewportZoomedIn(input.zoom);
  const zoom = input.zoom ?? 1;

  const getAxisBounds = (pageSize: number, frameSize: number) => {
    if (pageSize > frameSize) return { min: frameSize - pageSize, max: 0 };

    const slack = frameSize - pageSize;
    const center = slack / 2;
    if (!zoomedIn || slack <= 0 || pageSize <= 0) {
      return { min: center, max: center };
    }

    // How far this axis has travelled from fitted towards filling the frame.
    // `pageSize` is the fitted size times `zoom`, so the fill zoom is a
    // property of the axis rather than of the moment.
    const fillZoom = (frameSize * zoom) / pageSize;
    const travel = fillZoom - 1;
    const progress =
      travel > 0 ? Math.min(1, Math.max(0, (zoom - 1) / travel)) : 1;
    // Square root rather than the raw progress: the range wants to be wide
    // enough to honour the pinch anchor as soon as the reader leaves the fitted
    // view, while still closing to nothing exactly at fit so that pinching all
    // the way back out settles the sheet centred without a sideways jump.
    const reach = center * Math.sqrt(progress);
    return { min: center - reach, max: center + reach };
  };
  const horizontal = getAxisBounds(pageWidth, frameWidth);
  const vertical = getAxisBounds(pageHeight, frameHeight);

  return {
    minX: horizontal.min,
    maxX: horizontal.max,
    minY: vertical.min,
    maxY: vertical.max,
  };
}

export function clampNotebookViewportOrigin(input: {
  origin: NotebookViewportPoint;
  bounds: NotebookViewportPanBounds;
}): NotebookViewportPoint {
  const centeredX = (input.bounds.minX + input.bounds.maxX) / 2;
  const centeredY = (input.bounds.minY + input.bounds.maxY) / 2;
  const x = Number.isFinite(input.origin.x) ? input.origin.x : centeredX;
  const y = Number.isFinite(input.origin.y) ? input.origin.y : centeredY;

  return {
    x: Math.max(input.bounds.minX, Math.min(input.bounds.maxX, x)),
    y: Math.max(input.bounds.minY, Math.min(input.bounds.maxY, y)),
  };
}

/**
 * Calculates every sheet measurement from one fixed frame. Floating notebook
 * controls intentionally do not participate in this model.
 *
 * `zoom: 1` is the fitted 900 x 1240 page. `pageOrigin` is an absolute origin
 * inside the frame, matching the existing notebook pan representation.
 */
export function getNotebookViewportLayout(input: {
  frameWidth: number;
  frameHeight: number;
  zoom?: number;
  pan?: NotebookViewportPoint;
  pageWidth?: number;
  pageHeight?: number;
  swipeGap?: number;
}): NotebookViewportLayout {
  const frameSize = {
    width: finiteNonNegative(input.frameWidth),
    height: finiteNonNegative(input.frameHeight),
  };
  const logicalPageSize = {
    width: finiteNonNegative(
      input.pageWidth ?? NOTEBOOK_PAGE_COORDINATE_WIDTH
    ),
    height: finiteNonNegative(
      input.pageHeight ?? NOTEBOOK_PAGE_COORDINATE_HEIGHT
    ),
  };
  const inset = getNotebookViewportInset(
    frameSize.width,
    frameSize.height
  );
  const availableSize = {
    width: Math.max(0, frameSize.width - inset * 2),
    height: Math.max(0, frameSize.height - inset * 2),
  };
  const fitSize = getNotebookViewportFit({
    frameWidth: frameSize.width,
    frameHeight: frameSize.height,
    pageWidth: logicalPageSize.width,
    pageHeight: logicalPageSize.height,
    inset,
  });
  const fitScale =
    logicalPageSize.width > 0 ? fitSize.width / logicalPageSize.width : 0;
  const fitOrigin = {
    x: (frameSize.width - fitSize.width) / 2,
    y: (frameSize.height - fitSize.height) / 2,
  };
  const zoom = clampNotebookViewportZoom(input.zoom ?? 1);
  const pageSize = {
    width: fitSize.width * zoom,
    height: fitSize.height * zoom,
  };
  const panBounds = getNotebookViewportPanBounds({
    pageWidth: pageSize.width,
    pageHeight: pageSize.height,
    frameWidth: frameSize.width,
    frameHeight: frameSize.height,
    zoom,
  });
  const defaultOrigin = {
    x: (frameSize.width - pageSize.width) / 2,
    y: (frameSize.height - pageSize.height) / 2,
  };
  const pageOrigin = clampNotebookViewportOrigin({
    origin: input.pan ?? defaultOrigin,
    bounds: panBounds,
  });
  const swipeGap = finiteNonNegative(
    input.swipeGap ?? getNotebookViewportSwipeGap(frameSize.width)
  );

  return {
    frameSize,
    logicalPageSize,
    inset,
    availableSize,
    fitScale,
    fitSize,
    fitOrigin,
    zoom,
    pageSize,
    pageOrigin,
    panBounds,
    swipeGap,
    swipeTravel: getNotebookViewportSwipeTravel({
      frameWidth: frameSize.width,
      pageWidth: pageSize.width,
      swipeGap,
    }),
  };
}

export function getNotebookInkViewportScale(input: {
  displayWidth: number;
  displayHeight: number;
  pageWidth: number;
  pageHeight: number;
}) {
  const pageWidth = Math.max(1, input.pageWidth);
  const pageHeight = Math.max(1, input.pageHeight);
  return {
    x: Math.max(0, input.displayWidth) / pageWidth,
    y: Math.max(0, input.displayHeight) / pageHeight,
  };
}

export type NotebookAnimationFrameScheduler = {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (frameId: number) => void;
};

export type NotebookPinchFrameQueue = {
  queue: (callback: () => void) => void;
  cancel: () => void;
  hasPendingFrame: () => boolean;
};

/**
 * Coalesces repeated live-pinch writes into one animation frame. The queued
 * frame runs the latest callback, while cancellation also invalidates a stale
 * callback if a scheduler happens to deliver it after cancelFrame.
 */
export function createNotebookPinchFrameQueue(
  scheduler: NotebookAnimationFrameScheduler
): NotebookPinchFrameQueue {
  type PendingFrame = {
    id: number | null;
  };

  let pendingFrame: PendingFrame | null = null;
  let latestCallback: (() => void) | null = null;

  return {
    queue(callback) {
      latestCallback = callback;
      if (pendingFrame) return;

      const requestedFrame: PendingFrame = { id: null };
      pendingFrame = requestedFrame;
      requestedFrame.id = scheduler.requestFrame(() => {
        if (pendingFrame !== requestedFrame) return;

        pendingFrame = null;
        const callbackToRun = latestCallback;
        latestCallback = null;
        callbackToRun?.();
      });
    },
    cancel() {
      const frameToCancel = pendingFrame;
      pendingFrame = null;
      latestCallback = null;
      if (frameToCancel?.id !== null && frameToCancel?.id !== undefined) {
        scheduler.cancelFrame(frameToCancel.id);
      }
    },
    hasPendingFrame() {
      return pendingFrame !== null;
    },
  };
}
