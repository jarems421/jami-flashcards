"use client";

import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  getNotebookPdfRenderMetrics,
  loadNotebookPdfJs,
} from "@/lib/workspace/notebook-pdf";

const documentCache = new Map<string, Promise<PDFDocumentProxy>>();

function getPdfDocument(url: string) {
  let cached = documentCache.get(url);
  if (!cached) {
    cached = loadNotebookPdfJs().then(
      async (pdfjs) => pdfjs.getDocument({ url }).promise
    );
    documentCache.set(url, cached);
    cached.catch(() => documentCache.delete(url));
  }
  return cached;
}

type NotebookPdfPageProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  url: string;
  pageIndex: number;
  lazy?: boolean;
  maxPixelRatio?: number;
};

export default function NotebookPdfPage({
  url,
  pageIndex,
  lazy = false,
  maxPixelRatio = 2,
  className = "",
  ...props
}: NotebookPdfPageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sizeRevision, setSizeRevision] = useState(0);
  const [visible, setVisible] = useState(!lazy);
  const renderKey = `${url}|${pageIndex}|${sizeRevision}|${visible}`;
  const [renderState, setRenderState] = useState<{
    key: string;
    status: "ready" | "error";
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
    const observer = new ResizeObserver(() => {
      setSizeRevision((current) => current + 1);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!visible || !host || !canvas || !url) return;

    let disposed = false;
    let renderTask: RenderTask | null = null;
    void getPdfDocument(url)
      .then(async (pdf) => {
        if (disposed) return;
        const normalizedPageIndex = Math.max(
          0,
          Math.min(pdf.numPages - 1, Math.round(pageIndex))
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
          setRenderState({ key: renderKey, status: "error" });
        }
      });

    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [maxPixelRatio, pageIndex, renderKey, sizeRevision, url, visible]);

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
          This PDF page could not be rendered.
        </div>
      ) : null}
    </div>
  );
}
