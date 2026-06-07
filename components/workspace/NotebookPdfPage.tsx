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
  getNotebookPdfRenderMetrics,
  loadNotebookPdfJs,
  validateNotebookPdfPageIndex,
} from "@/lib/workspace/notebook-pdf";
import { getNotebookFileBytes } from "@/services/study/notebook-files";

const documentCache = createNotebookPdfDocumentCache<PDFDocumentProxy>(
  async (storagePath) => {
    const [pdfjs, bytes] = await Promise.all([
      loadNotebookPdfJs(),
      getNotebookFileBytes(storagePath),
    ]);
    return pdfjs.getDocument({ data: bytes }).promise;
  }
);

type NotebookPdfPageProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  storagePath: string;
  pageIndex: number;
  lazy?: boolean;
  maxPixelRatio?: number;
};

export default function NotebookPdfPage({
  storagePath,
  pageIndex,
  lazy = false,
  maxPixelRatio = 2,
  className = "",
  ...props
}: NotebookPdfPageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostSizeRef = useRef({ width: 0, height: 0 });
  const [sizeRevision, setSizeRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const [visible, setVisible] = useState(!lazy);
  const renderKey = `${storagePath}|${pageIndex}|${sizeRevision}|${visible}|${retryRevision}`;
  const [renderState, setRenderState] = useState<{
    key: string;
    status: "ready" | "error";
    message?: string;
  } | null>(null);
  const status =
    renderState?.key === renderKey ? renderState.status : "loading";

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

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!visible || !host || !canvas || !storagePath) return;

    let disposed = false;
    let renderTask: RenderTask | null = null;
    let stage: "file" | "page" | "render" = "file";
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
        const metrics = getNotebookPdfRenderMetrics({
          pageWidth: baseViewport.width,
          pageHeight: baseViewport.height,
          hostWidth: host.clientWidth,
          hostHeight: host.clientHeight,
          pixelRatio: window.devicePixelRatio || 1,
          maxPixelRatio,
        });
        const viewport = page.getViewport({
          scale: metrics.cssScale * metrics.pixelRatio,
        });

        canvas.width = metrics.canvasWidth;
        canvas.height = metrics.canvasHeight;
        canvas.style.width = `${metrics.cssWidth}px`;
        canvas.style.height = `${metrics.cssHeight}px`;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable.");

        stage = "render";
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          background: "#ffffff",
        });
        await renderTask.promise;
        if (!disposed) setRenderState({ key: renderKey, status: "ready" });
      })
      .catch((error) => {
        if (
          !disposed &&
          !(error instanceof Error && error.name === "RenderingCancelledException")
        ) {
          console.error("Notebook PDF render failed.", {
            storagePath,
            pageIndex,
            stage,
            error,
          });
          setRenderState({
            key: renderKey,
            status: "error",
            message:
              stage === "file"
                ? "This PDF could not be loaded from your notebook."
                : stage === "page"
                  ? "This page is missing from the uploaded PDF."
                  : "This PDF page could not be rendered.",
          });
        }
      });

    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [
    maxPixelRatio,
    pageIndex,
    renderKey,
    sizeRevision,
    storagePath,
    visible,
  ]);

  return (
    <div
      ref={hostRef}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-white ${className}`}
      {...props}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`block max-h-full max-w-full transition-opacity ${
          status === "ready" ? "opacity-100" : "opacity-0"
        }`}
      />
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
