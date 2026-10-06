"use client";

import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { createNotebookPdfDocumentCache } from "@/lib/workspace/notebook-pdf-cache";
import {
  getNotebookPdfCanvasPlacement,
  getNotebookPdfDetailRender,
  getNotebookPdfRenderMetrics,
  loadNotebookPdfJs,
  MAX_NOTEBOOK_PDF_CANVAS_PIXELS,
  sameNotebookPdfDetailRender,
  shouldRerenderNotebookPdfCanvas,
  validateNotebookPdfPageIndex,
  type NotebookPdfDetailRender,
  type NotebookPdfDetailWindow,
} from "@/lib/workspace/notebook-pdf";
import { whenNotebookInkIdle } from "@/lib/workspace/notebook-ink-activity";
import { getNotebookFileBytes } from "@/services/study/notebook-files";

const documentLoadingTasks = new WeakMap<
  PDFDocumentProxy,
  { destroy: () => Promise<void> }
>();
const documentCache = createNotebookPdfDocumentCache<PDFDocumentProxy>(
  async (storagePath) => {
    const [pdfjs, bytes] = await Promise.all([
      loadNotebookPdfJs(),
      getNotebookFileBytes(storagePath),
    ]);
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    documentLoadingTasks.set(pdf, loadingTask);
    return pdf;
  },
  6,
  async (pdf) => {
    const loadingTask = documentLoadingTasks.get(pdf);
    documentLoadingTasks.delete(pdf);
    if (loadingTask) {
      await loadingTask.destroy();
      return;
    }
    await pdf.cleanup();
  }
);

type NotebookPdfPageProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  storagePath: string;
  pageIndex: number;
  lazy?: boolean;
  maxPixelRatio?: number;
  maxCanvasPixels?: number;
  fadeIn?: boolean;
  /**
   * The part of the page on screen, in this element's CSS pixels. When the
   * whole-page canvas is below the screen's density, this slice is drawn
   * again on top at full density. Only the page being written on passes it.
   */
  detailWindow?: NotebookPdfDetailWindow | null;
  onRenderStateChange?: (state: NotebookPdfRenderState) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
};

/** The sharp slice on screen, and the host size it was drawn for. */
type ShownPdfDetail = {
  contentKey: string;
  render: NotebookPdfDetailRender;
  hostWidth: number;
  hostHeight: number;
};

export type NotebookPdfRenderState = "loading" | "ready" | "error";

/** What the canvas on screen is showing, and at how many pixels. */
type ShownPdfCanvas = {
  contentKey: string;
  width: number;
  height: number;
};

/**
 * One page of an imported PDF, drawn by pdf.js.
 *
 * Two canvases, one on screen and one spare. A new size is drawn into the
 * spare and swapped in only once it is finished, so a zoom never shows the
 * blank "Loading page..." sheet it used to: the page already on screen is
 * stretched to the new size straight away and sharpens when the redraw lands.
 * Only a new page, or a first draw, shows the loading state.
 *
 * pdf.js draws on the main thread, so its slices are also held while a pen is
 * on the page -- see `notebook-ink-activity.ts`.
 *
 * Zoomed in, the whole-page canvas runs out of pixels before the screen does,
 * so the part on screen (`detailWindow`) is drawn a second time at the
 * screen's density, on top -- see `getNotebookPdfDetailRender`. It has its own
 * pair of canvases, swapped the same way, and is let go whenever the whole
 * page is sharp enough without it.
 */
export default function NotebookPdfPage({
  storagePath,
  pageIndex,
  lazy = false,
  maxPixelRatio = 2,
  maxCanvasPixels = MAX_NOTEBOOK_PDF_CANVAS_PIXELS,
  fadeIn = true,
  detailWindow,
  onRenderStateChange,
  onCanvasReady,
  className = "",
  ...props
}: NotebookPdfPageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const firstCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const secondCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const firstDetailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const secondDetailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detailFrontIndexRef = useRef<0 | 1>(0);
  const detailShownRef = useRef<ShownPdfDetail | null>(null);
  const hasDetailWindow = Boolean(detailWindow);
  const detailLeft = detailWindow?.left ?? 0;
  const detailTop = detailWindow?.top ?? 0;
  const detailWidth = detailWindow?.width ?? 0;
  const detailHeight = detailWindow?.height ?? 0;
  /** Which of the two canvases is on screen. */
  const frontIndexRef = useRef<0 | 1>(0);
  const shownRef = useRef<ShownPdfCanvas | null>(null);
  const hostSizeRef = useRef({ width: 0, height: 0 });
  const onRenderStateChangeRef = useRef(onRenderStateChange);
  const onCanvasReadyRef = useRef(onCanvasReady);
  const [sizeRevision, setSizeRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const [visible, setVisible] = useState(!lazy);
  // Size is deliberately not part of this: a new size keeps showing the page.
  const contentKey = `${storagePath}|${pageIndex}|${visible}|${retryRevision}`;
  const [renderState, setRenderState] = useState<{
    key: string;
    status: "ready" | "error";
    message?: string;
  } | null>(null);
  const status =
    renderState?.key === contentKey ? renderState.status : "loading";

  useEffect(() => {
    onRenderStateChangeRef.current = onRenderStateChange;
  }, [onRenderStateChange]);

  useEffect(() => {
    onCanvasReadyRef.current = onCanvasReady;
  }, [onCanvasReady]);

  useEffect(() => {
    onRenderStateChangeRef.current?.(status);
  }, [status]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !lazy) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { rootMargin: "160px" }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [lazy]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let animationFrame = 0;
    const observer = new ResizeObserver(([entry]) => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const width = Math.round(entry?.contentRect.width ?? host.clientWidth);
        const height = Math.round(
          entry?.contentRect.height ?? host.clientHeight
        );
        if (
          width === hostSizeRef.current.width &&
          height === hostSizeRef.current.height
        ) {
          return;
        }
        hostSizeRef.current = { width, height };
        setSizeRevision((current) => current + 1);
      });
    });
    observer.observe(host);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, []);

  // A different page (or a retry) invalidates the canvas handed out for Tutor.
  useEffect(
    () => () => {
      onCanvasReadyRef.current?.(null);
    },
    [contentKey]
  );

  useEffect(() => {
    const host = hostRef.current;
    const first = firstCanvasRef.current;
    const second = secondCanvasRef.current;
    if (!visible || !host || !first || !second || !storagePath) return;
    const canvases = [first, second] as const;

    let disposed = false;
    let renderTask: RenderTask | null = null;
    let cancelIdleWait: (() => void) | null = null;
    let stage: "file" | "page" | "render" = "file";
    const shown =
      shownRef.current?.contentKey === contentKey ? shownRef.current : null;

    void documentCache
      .get(storagePath)
      .then(async (pdf) => {
        if (disposed) return;
        stage = "page";
        const normalizedPageIndex = validateNotebookPdfPageIndex(
          pageIndex,
          pdf.numPages
        );
        const page = await pdf.getPage(normalizedPageIndex + 1);
        if (disposed) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const hostWidth = host.clientWidth;
        const hostHeight = host.clientHeight;
        const metrics = getNotebookPdfRenderMetrics({
          pageWidth: baseViewport.width,
          pageHeight: baseViewport.height,
          hostWidth,
          hostHeight,
          pixelRatio: window.devicePixelRatio || 1,
          maxPixelRatio,
          maxCanvasPixels,
        });
        const placement = getNotebookPdfCanvasPlacement({
          cssWidth: metrics.cssWidth,
          cssHeight: metrics.cssHeight,
          hostWidth,
          hostHeight,
        });
        const front = canvases[frontIndexRef.current];
        const spare = canvases[frontIndexRef.current === 0 ? 1 : 0];

        if (shown) {
          // The host may have changed shape, not just size, so the page on
          // screen is re-placed whether or not it is redrawn.
          placeNotebookPdfCanvas(front, placement);
          if (!shouldRerenderNotebookPdfCanvas({ current: shown, next: metrics })) {
            return;
          }
        }

        // With nothing shown yet the front canvas is drawn directly, under the
        // loading sheet. Otherwise the spare is, out of sight.
        const target = shown ? spare : front;
        if (!shown) spare.style.visibility = "hidden";
        target.style.visibility = shown ? "hidden" : "visible";
        target.width = metrics.canvasWidth;
        target.height = metrics.canvasHeight;
        placeNotebookPdfCanvas(target, placement);
        const context = target.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable.");

        const viewport = page.getViewport({
          scale: metrics.cssScale * metrics.pixelRatio,
        });
        stage = "render";
        const task = page.render({
          canvas: target,
          canvasContext: context,
          viewport,
          background: "#ffffff",
        });
        renderTask = task;
        // pdf.js asks before every slice. Hold the slice while a pen is down.
        task.onContinue = (next: () => void) => {
          cancelIdleWait = whenNotebookInkIdle(() => {
            cancelIdleWait = null;
            next();
          });
        };
        await task.promise;
        if (disposed) return;

        if (target !== front) {
          // Swapped in one task, so no frame shows neither canvas.
          target.style.visibility = "visible";
          front.style.visibility = "hidden";
          frontIndexRef.current = frontIndexRef.current === 0 ? 1 : 0;
          // The old page is not needed until the next redraw resizes it.
          front.width = 1;
          front.height = 1;
        }
        shownRef.current = {
          contentKey,
          width: target.width,
          height: target.height,
        };
        setRenderState((current) =>
          current?.key === contentKey && current.status === "ready"
            ? current
            : { key: contentKey, status: "ready" }
        );
        onCanvasReadyRef.current?.(target);
      })
      .catch((error) => {
        if (
          disposed ||
          (error instanceof Error && error.name === "RenderingCancelledException")
        ) {
          return;
        }
        console.error("Notebook PDF render failed.", {
          storagePath,
          pageIndex,
          stage,
          error,
        });
        // A sharper redraw failing is no reason to take down a page that is
        // already showing.
        if (shown) return;
        setRenderState({
          key: contentKey,
          status: "error",
          message:
            stage === "file"
              ? "This PDF could not be loaded from your notebook."
              : stage === "page"
                ? "This page is missing from the uploaded PDF."
                : "This PDF page could not be rendered.",
        });
        onCanvasReadyRef.current?.(null);
      });

    return () => {
      disposed = true;
      cancelIdleWait?.();
      renderTask?.cancel();
    };
  }, [
    contentKey,
    maxCanvasPixels,
    maxPixelRatio,
    pageIndex,
    sizeRevision,
    storagePath,
    visible,
  ]);

  // The sharp slice over a zoomed page. Drawn only once the whole page is up.
  useEffect(() => {
    const host = hostRef.current;
    const first = firstDetailCanvasRef.current;
    const second = secondDetailCanvasRef.current;
    if (!host || !first || !second) return;
    const canvases = [first, second] as const;
    const letGo = () => {
      for (const canvas of canvases) {
        canvas.style.visibility = "hidden";
        canvas.width = 1;
        canvas.height = 1;
      }
      detailShownRef.current = null;
    };
    if (status !== "ready" || !visible || !storagePath || !hasDetailWindow) {
      letGo();
      return;
    }

    const hostWidth = host.clientWidth;
    const hostHeight = host.clientHeight;
    const shown = detailShownRef.current;
    // A new zoom makes the old slice the wrong size, so it goes at once; the
    // whole page shows underneath until the new one lands. A pan keeps it.
    if (
      shown &&
      (shown.contentKey !== contentKey ||
        shown.hostWidth !== hostWidth ||
        shown.hostHeight !== hostHeight)
    ) {
      letGo();
    }

    let disposed = false;
    let renderTask: RenderTask | null = null;
    let cancelIdleWait: (() => void) | null = null;
    void documentCache
      .get(storagePath)
      .then(async (pdf) => {
        if (disposed) return;
        const page = await pdf.getPage(
          validateNotebookPdfPageIndex(pageIndex, pdf.numPages) + 1
        );
        if (disposed) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const pixelRatio = window.devicePixelRatio || 1;
        const metrics = getNotebookPdfRenderMetrics({
          pageWidth: baseViewport.width,
          pageHeight: baseViewport.height,
          hostWidth,
          hostHeight,
          pixelRatio,
          maxPixelRatio,
          maxCanvasPixels,
        });
        const detail = getNotebookPdfDetailRender({
          window: {
            left: detailLeft,
            top: detailTop,
            width: detailWidth,
            height: detailHeight,
          },
          cssWidth: metrics.cssWidth,
          cssHeight: metrics.cssHeight,
          basePixelRatio: metrics.pixelRatio,
          hostWidth,
          hostHeight,
          devicePixelRatio: pixelRatio,
        });
        if (!detail) {
          letGo();
          return;
        }
        const current = detailShownRef.current;
        if (current && sameNotebookPdfDetailRender(current.render, detail)) return;

        const front = canvases[detailFrontIndexRef.current];
        const spare = canvases[detailFrontIndexRef.current === 0 ? 1 : 0];
        const target = current ? spare : front;
        target.style.visibility = "hidden";
        target.width = detail.canvasWidth;
        target.height = detail.canvasHeight;
        target.style.left = `${detail.left}px`;
        target.style.top = `${detail.top}px`;
        target.style.width = `${detail.width}px`;
        target.style.height = `${detail.height}px`;
        const context = target.getContext("2d", { alpha: false });
        if (!context) return;
        const task = page.render({
          canvas: target,
          canvasContext: context,
          viewport: page.getViewport({ scale: metrics.cssScale * detail.pixelRatio }),
          // Shift the page so the slice's corner lands on the canvas's corner.
          transform: [1, 0, 0, 1, -detail.offsetX, -detail.offsetY],
          background: "#ffffff",
        });
        renderTask = task;
        task.onContinue = (next: () => void) => {
          cancelIdleWait = whenNotebookInkIdle(() => {
            cancelIdleWait = null;
            next();
          });
        };
        await task.promise;
        if (disposed) return;
        target.style.visibility = "visible";
        if (target !== front) {
          front.style.visibility = "hidden";
          front.width = 1;
          front.height = 1;
          detailFrontIndexRef.current = detailFrontIndexRef.current === 0 ? 1 : 0;
        }
        detailShownRef.current = { contentKey, render: detail, hostWidth, hostHeight };
      })
      .catch((error) => {
        if (
          disposed ||
          (error instanceof Error && error.name === "RenderingCancelledException")
        ) {
          return;
        }
        // The whole page is still showing; the slice is only ever extra.
        console.warn("Notebook PDF detail render failed.", { storagePath, pageIndex, error });
      });

    return () => {
      disposed = true;
      cancelIdleWait?.();
      renderTask?.cancel();
    };
  }, [
    contentKey,
    detailHeight,
    detailLeft,
    detailTop,
    detailWidth,
    hasDetailWindow,
    maxCanvasPixels,
    maxPixelRatio,
    pageIndex,
    sizeRevision,
    status,
    storagePath,
    visible,
  ]);

  return (
    <div
      ref={hostRef}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-white ${className}`}
      {...props}
    >
      <div
        aria-hidden="true"
        className={`absolute inset-0 ${fadeIn ? "transition-opacity" : ""} ${
          status === "ready" ? "opacity-100" : "opacity-0"
        }`}
      >
        <canvas ref={firstCanvasRef} className="absolute block" />
        <canvas ref={secondCanvasRef} className="invisible absolute block" />
        <canvas ref={firstDetailCanvasRef} className="invisible absolute block" />
        <canvas ref={secondDetailCanvasRef} className="invisible absolute block" />
      </div>
      {status === "loading" ? (
        <div className="absolute inset-0 grid place-items-center bg-white text-xs font-semibold text-slate-500">
          Loading page...
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 grid place-items-center bg-white px-4 text-center text-xs font-semibold text-slate-600">
          <div className="space-y-2">
            <p>{renderState?.message}</p>
            <button
              type="button"
              className="pointer-events-auto rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              onClick={() => {
                documentCache.invalidate(storagePath);
                setRetryRevision((current) => current + 1);
              }}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function placeNotebookPdfCanvas(
  canvas: HTMLCanvasElement,
  placement: ReturnType<typeof getNotebookPdfCanvasPlacement>
) {
  canvas.style.width = `${placement.width}%`;
  canvas.style.height = `${placement.height}%`;
  canvas.style.left = `${placement.left}%`;
  canvas.style.top = `${placement.top}%`;
}
