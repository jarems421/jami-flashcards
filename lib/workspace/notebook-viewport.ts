import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";

export const NOTEBOOK_VIEWPORT_MIN_ZOOM = 0.92;
export const NOTEBOOK_VIEWPORT_MAX_ZOOM = 4;
export const NOTEBOOK_VIEWPORT_COMPACT_MAX_WIDTH = 767;
export const NOTEBOOK_VIEWPORT_COMPACT_INSET = 12;
export const NOTEBOOK_VIEWPORT_REGULAR_INSET = 16;
export const NOTEBOOK_VIEWPORT_SWIPE_GAP = 16;

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

export function clampNotebookViewportZoom(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(
    NOTEBOOK_VIEWPORT_MIN_ZOOM,
    Math.min(NOTEBOOK_VIEWPORT_MAX_ZOOM, value)
  );
}

export function getNotebookViewportInset(frameWidth: number) {
  return finiteNonNegative(frameWidth) <= NOTEBOOK_VIEWPORT_COMPACT_MAX_WIDTH
    ? NOTEBOOK_VIEWPORT_COMPACT_INSET
    : NOTEBOOK_VIEWPORT_REGULAR_INSET;
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
    input.inset ?? getNotebookViewportInset(frameWidth)
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

/**
 * Keeps the notebook at roughly the same physical size when a screen rotates.
 * Portrait already has the desired framing, so it returns 1 there. In
 * landscape it compares the true contain-fit with the fit the same viewport
 * would have in portrait orientation. The fitted page remains available at
 * zoom 1 (and with extra workspace at the 0.92 floor).
 */
export function getNotebookViewportPreferredZoom(input: {
  frameWidth: number;
  frameHeight: number;
  pageWidth?: number;
  pageHeight?: number;
  inset?: number;
}) {
  const frameWidth = finiteNonNegative(input.frameWidth);
  const frameHeight = finiteNonNegative(input.frameHeight);
  const pageWidth = finiteNonNegative(
    input.pageWidth ?? NOTEBOOK_PAGE_COORDINATE_WIDTH
  );
  const pageHeight = finiteNonNegative(
    input.pageHeight ?? NOTEBOOK_PAGE_COORDINATE_HEIGHT
  );
  if (
    frameWidth === 0 ||
    frameHeight === 0 ||
    pageWidth === 0 ||
    pageHeight === 0 ||
    frameWidth <= frameHeight
  ) {
    return 1;
  }

  const inset = finiteNonNegative(
    input.inset ?? getNotebookViewportInset(frameWidth)
  );
  const fitSize = getNotebookViewportFit({
    frameWidth,
    frameHeight,
    pageWidth,
    pageHeight,
    inset,
  });
  const portraitEquivalentFit = getNotebookViewportFit({
    frameWidth: Math.min(frameWidth, frameHeight),
    frameHeight: Math.max(frameWidth, frameHeight),
    pageWidth,
    pageHeight,
    inset,
  });
  const fitScale = fitSize.width / pageWidth;
  const preferredScale = portraitEquivalentFit.width / pageWidth;
  if (fitScale <= 0 || preferredScale <= 0) return 1;

  return clampNotebookViewportZoom(Math.max(1, preferredScale / fitScale));
}

export function getNotebookViewportZoomAfterPreferredSizeChange(input: {
  zoom: number;
  previousPreferredZoom: number;
  nextPreferredZoom: number;
}) {
  const previousPreferredZoom =
    Number.isFinite(input.previousPreferredZoom) &&
    input.previousPreferredZoom > 0
      ? input.previousPreferredZoom
      : 1;
  const nextPreferredZoom =
    Number.isFinite(input.nextPreferredZoom) && input.nextPreferredZoom > 0
      ? input.nextPreferredZoom
      : 1;
  const zoom = Number.isFinite(input.zoom)
    ? input.zoom
    : previousPreferredZoom;

  return clampNotebookViewportZoom(
    (zoom / previousPreferredZoom) * nextPreferredZoom
  );
}

export function getNotebookViewportPanBounds(input: {
  pageWidth: number;
  pageHeight: number;
  frameWidth: number;
  frameHeight: number;
}): NotebookViewportPanBounds {
  const pageWidth = finiteNonNegative(input.pageWidth);
  const pageHeight = finiteNonNegative(input.pageHeight);
  const frameWidth = finiteNonNegative(input.frameWidth);
  const frameHeight = finiteNonNegative(input.frameHeight);

  const getAxisBounds = (pageSize: number, frameSize: number) => {
    if (pageSize <= frameSize) {
      const center = (frameSize - pageSize) / 2;
      return { min: center, max: center };
    }
    return { min: frameSize - pageSize, max: 0 };
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
  const inset = getNotebookViewportInset(frameSize.width);
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
    input.swipeGap ?? NOTEBOOK_VIEWPORT_SWIPE_GAP
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
    swipeTravel: pageSize.width + swipeGap,
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
