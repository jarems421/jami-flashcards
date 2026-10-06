export const MAX_NOTEBOOK_PDF_PAGES = 200;
export const MAX_NOTEBOOK_FILE_SIZE = 20 * 1024 * 1024;
// A single RGBA canvas at this ceiling uses roughly 24 MiB. This avoids the
// 30-100 MiB canvases that high zoom + Retina DPR could allocate on iPad.
export const MAX_NOTEBOOK_PDF_CANVAS_PIXELS = 6_000_000;

type PdfJsModule = typeof import("pdfjs-dist");

let pdfJsPromise: Promise<PdfJsModule> | null = null;

export function validateOwnedNotebookPdfStoragePath(
  storagePath: string,
  userId: string
) {
  const normalizedPath = storagePath.trim();
  const normalizedUserId = userId.trim();
  const prefix = `users/${normalizedUserId}/notebookFiles/`;
  const pathSegments = normalizedPath.split("/");

  if (
    !normalizedUserId ||
    !normalizedPath.startsWith(prefix) ||
    pathSegments.length !== 5 ||
    pathSegments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid notebook PDF path.");
  }

  return normalizedPath;
}

export async function loadNotebookPdfJs() {
  pdfJsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    return pdfjs;
  });
  return pdfJsPromise;
}

export function validateNotebookPdfPageCount(pageCount: number) {
  if (!Number.isFinite(pageCount) || pageCount < 1) {
    throw new Error("This PDF does not contain any readable pages.");
  }
  if (pageCount > MAX_NOTEBOOK_PDF_PAGES) {
    throw new Error(
      `PDF notebooks support up to ${MAX_NOTEBOOK_PDF_PAGES} pages.`
    );
  }
  return Math.round(pageCount);
}

export function validateNotebookPdfPageIndex(
  pageIndex: number,
  pageCount: number
) {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
    throw new Error(
      `PDF page ${pageIndex + 1} is unavailable in this ${pageCount}-page file.`
    );
  }
  return pageIndex;
}

export function assertImportedNotebookPageCount(
  expectedPageCount: number,
  createdPageCount: number
) {
  if (createdPageCount !== expectedPageCount) {
    throw new Error(
      `Expected ${expectedPageCount} imported pages, but created ${createdPageCount}.`
    );
  }
}

export function buildUploadedNotebookPageMappings(input: {
  pageCount: number;
  fileId: string;
  isPdf: boolean;
}) {
  const pageCount = validateNotebookPdfPageCount(input.pageCount);
  const fileId = input.fileId.trim();
  if (!fileId) throw new Error("Missing notebook file.");
  return Array.from({ length: pageCount }, (_, index) => ({
    pageNumber: index + 1,
    title: `Page ${index + 1}`,
    backgroundFileId: fileId,
    pdfPageIndex: input.isPdf ? index : undefined,
  }));
}

export function getNotebookPdfRenderMetrics(input: {
  pageWidth: number;
  pageHeight: number;
  hostWidth: number;
  hostHeight: number;
  pixelRatio: number;
  maxPixelRatio?: number;
  maxCanvasPixels?: number;
}) {
  const maxPixelRatio = input.maxPixelRatio ?? 2;
  const maxCanvasPixels =
    Number.isFinite(input.maxCanvasPixels) && (input.maxCanvasPixels ?? 0) > 0
      ? Math.max(1, Math.floor(input.maxCanvasPixels!))
      : MAX_NOTEBOOK_PDF_CANVAS_PIXELS;
  const cssScale = Math.min(
    Math.max(1, input.hostWidth) / Math.max(1, input.pageWidth),
    Math.max(1, input.hostHeight) / Math.max(1, input.pageHeight)
  );
  const desiredPixelRatio = Math.min(
    maxPixelRatio,
    Math.max(1, input.pixelRatio || 1)
  );
  const cssWidth = input.pageWidth * cssScale;
  const cssHeight = input.pageHeight * cssScale;
  const desiredPixels = cssWidth * cssHeight * desiredPixelRatio ** 2;
  const pixelRatio =
    desiredPixels > maxCanvasPixels
      ? desiredPixelRatio * Math.sqrt(maxCanvasPixels / desiredPixels)
      : desiredPixelRatio;
  return {
    cssScale,
    pixelRatio,
    canvasWidth: Math.max(
      1,
      Math.floor(input.pageWidth * cssScale * pixelRatio)
    ),
    canvasHeight: Math.max(
      1,
      Math.floor(input.pageHeight * cssScale * pixelRatio)
    ),
    cssWidth,
    cssHeight,
  };
}

/**
 * Whether a PDF page already on screen needs drawing again for a new size.
 *
 * Every zoom used to redraw the page from scratch, and on an iPad a heavy page
 * takes seconds of main-thread work to draw. Most of those redraws bought
 * nothing: past about 1.3x zoom the canvas is already at its pixel ceiling, so
 * the "new" canvas came out exactly the size of the old one.
 *
 * So a page is only redrawn when it needs more pixels than it has, or when it
 * has so many more than it needs that scaling it down would shimmer (over
 * twice the size on a side). Everything in between is scaled by the
 * compositor, which is free.
 */
export function shouldRerenderNotebookPdfCanvas(input: {
  current: { width: number; height: number } | null;
  next: { canvasWidth: number; canvasHeight: number };
}) {
  const current = input.current;
  if (!current || current.width <= 1 || current.height <= 1) return true;
  // A pixel or two either way is layout rounding, not a size change.
  const tolerance = 2;
  const { canvasWidth, canvasHeight } = input.next;
  const needsMore =
    canvasWidth > current.width + tolerance ||
    canvasHeight > current.height + tolerance;
  const farTooMany =
    current.width > canvasWidth * 2 + tolerance ||
    current.height > canvasHeight * 2 + tolerance;
  return needsMore || farTooMany;
}

/**
 * Where a PDF page canvas sits inside its host, as percentages of the host.
 *
 * Percentages rather than pixels so that when the host grows -- a zoom -- the
 * canvas already on screen grows with it at once, slightly soft until the
 * sharper redraw lands, instead of staying small or going blank.
 */
/**
 * The sharp layer over a zoomed PDF page: only the part on screen, drawn at
 * the screen's own density.
 *
 * The whole-page canvas has a pixel ceiling, which a zoomed page passes
 * early -- around 1.3x on an iPad -- and from there its density falls as the
 * zoom rises: a 2x screen at 3x zoom was being shown about one pixel per
 * point, softer than a non-Retina screen. That is exactly where someone is
 * writing small. So the whole page stays as it is, for panning into, and the
 * visible slice is drawn again on top at full density. The slice is a little
 * over one screen, so it costs about what the whole page did at fit.
 */
export const MAX_NOTEBOOK_PDF_DETAIL_PIXELS = 6_000_000;
export const MAX_NOTEBOOK_PDF_DETAIL_PIXEL_RATIO = 3;

/** The visible part of the page, in the PDF host's CSS pixels. */
export type NotebookPdfDetailWindow = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type NotebookPdfDetailRender = {
  /** Where the sharp canvas sits in the host, in CSS pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  pixelRatio: number;
  canvasWidth: number;
  canvasHeight: number;
  /** How far into the page, in canvas pixels, the slice starts. */
  offsetX: number;
  offsetY: number;
};

/**
 * Which slice to draw sharp, or null when the whole-page canvas is already
 * as sharp as the screen -- every fitted page, and any zoom below the
 * ceiling.
 */
export function getNotebookPdfDetailRender(input: {
  window: NotebookPdfDetailWindow | null | undefined;
  /** The whole page as drawn: its size in the host and its density. */
  cssWidth: number;
  cssHeight: number;
  basePixelRatio: number;
  hostWidth: number;
  hostHeight: number;
  devicePixelRatio: number;
  maxPixelRatio?: number;
  maxCanvasPixels?: number;
}): NotebookPdfDetailRender | null {
  const window = input.window;
  if (!window || !(window.width > 0) || !(window.height > 0)) return null;
  const desired = Math.min(
    input.maxPixelRatio ?? MAX_NOTEBOOK_PDF_DETAIL_PIXEL_RATIO,
    Math.max(1, Number.isFinite(input.devicePixelRatio) ? input.devicePixelRatio : 1)
  );
  // Within a few per cent of the screen, the page is already sharp.
  if (!(input.basePixelRatio < desired * 0.95)) return null;

  // The PDF is centred in its host, as the whole-page canvas is placed.
  const pdfLeft = (input.hostWidth - input.cssWidth) / 2;
  const pdfTop = (input.hostHeight - input.cssHeight) / 2;
  const left = Math.max(pdfLeft, Math.floor(window.left));
  const top = Math.max(pdfTop, Math.floor(window.top));
  const right = Math.min(pdfLeft + input.cssWidth, Math.ceil(window.left + window.width));
  const bottom = Math.min(pdfTop + input.cssHeight, Math.ceil(window.top + window.height));
  const width = right - left;
  const height = bottom - top;
  if (!(width > 0) || !(height > 0)) return null;

  const budget =
    Number.isFinite(input.maxCanvasPixels) && (input.maxCanvasPixels ?? 0) > 0
      ? input.maxCanvasPixels!
      : MAX_NOTEBOOK_PDF_DETAIL_PIXELS;
  const area = width * height;
  const pixelRatio = area * desired * desired > budget ? Math.sqrt(budget / area) : desired;
  // Not worth a second canvas unless it is clearly sharper than the first.
  if (pixelRatio < input.basePixelRatio * 1.1) return null;

  const canvasWidth = Math.max(1, Math.round(width * pixelRatio));
  const canvasHeight = Math.max(1, Math.round(height * pixelRatio));
  return {
    left,
    top,
    // Sized from the canvas so each canvas pixel lands on one screen pixel.
    width: canvasWidth / pixelRatio,
    height: canvasHeight / pixelRatio,
    pixelRatio,
    canvasWidth,
    canvasHeight,
    offsetX: (left - pdfLeft) * pixelRatio,
    offsetY: (top - pdfTop) * pixelRatio,
  };
}

/** Whether two slices would draw the same pixels in the same place. */
export function sameNotebookPdfDetailRender(
  first: NotebookPdfDetailRender | null,
  second: NotebookPdfDetailRender | null
) {
  if (first === second) return true;
  if (!first || !second) return false;
  return (
    first.left === second.left &&
    first.top === second.top &&
    first.canvasWidth === second.canvasWidth &&
    first.canvasHeight === second.canvasHeight &&
    first.pixelRatio === second.pixelRatio
  );
}

export function getNotebookPdfCanvasPlacement(input: {
  cssWidth: number;
  cssHeight: number;
  hostWidth: number;
  hostHeight: number;
}) {
  const width = Math.min(
    100,
    (Math.max(0, input.cssWidth) / Math.max(1, input.hostWidth)) * 100
  );
  const height = Math.min(
    100,
    (Math.max(0, input.cssHeight) / Math.max(1, input.hostHeight)) * 100
  );
  return {
    width,
    height,
    left: (100 - width) / 2,
    top: (100 - height) / 2,
  };
}

export function resolveNotebookPageBackgroundFileId(input: {
  pageBackgroundFileId?: string;
  notebookUploadedFileId?: string;
  firstFileId?: string;
  hasMappedPages?: boolean;
}) {
  if (input.pageBackgroundFileId) return input.pageBackgroundFileId;
  if (input.hasMappedPages) return undefined;
  return input.notebookUploadedFileId ?? input.firstFileId;
}

export async function getNotebookPdfPageCount(file: File) {
  if (file.type !== "application/pdf") return 1;
  try {
    const pdfjs = await loadNotebookPdfJs();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const pageCount = validateNotebookPdfPageCount(pdf.numPages);
    await loadingTask.destroy();
    return pageCount;
  } catch (error) {
    const name =
      typeof error === "object" && error && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";
    if (name === "PasswordException") {
      throw new Error("Password-protected PDFs are not supported.");
    }
    if (
      error instanceof Error &&
      (error.message.includes("up to") || error.message.includes("readable pages"))
    ) {
      throw error;
    }
    throw new Error("This PDF could not be opened. Choose a valid PDF file.");
  }
}
