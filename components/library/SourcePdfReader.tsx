"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  getNotebookPdfRenderMetrics,
  loadNotebookPdfJs,
  MAX_NOTEBOOK_PDF_PAGES,
} from "@/lib/workspace/notebook-pdf";
import { getNotebookFileBytes } from "@/services/study/notebook-files";

/**
 * Every page of a source PDF, one under another, to scroll through.
 *
 * It was an iframe, which a desktop browser fills with its own PDF viewer but
 * iPad Safari draws as the first page only, with no way on to the second.
 * Drawn with pdf.js instead, the same as notebook pages, so it reads the same
 * everywhere. Pages render as they come near the screen, so a long file does
 * not draw two hundred canvases up front.
 */
export default function SourcePdfReader({
  storagePath,
  title,
  fallback,
}: {
  storagePath: string;
  title: string;
  /** Shown when the file cannot be opened. */
  fallback: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const current = useSourcePdfDocument(storagePath);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry?.contentRect.width ?? host.clientWidth));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  if (current?.failed) return <>{fallback}</>;

  const pageCount = current?.pageCount ?? 0;

  return (
    <div
      ref={hostRef}
      role="document"
      aria-label={`${title} PDF`}
      className="flex w-full flex-col items-center gap-3 px-3 py-4 sm:gap-4 sm:px-6 sm:py-6"
    >
      {!current?.pdf || width === 0 ? (
        <div
          role="status"
          className="grid min-h-[22rem] w-full place-items-center text-sm font-semibold text-text-muted"
        >
          Loading PDF…
        </div>
      ) : (
        Array.from({ length: pageCount }, (_, index) => (
          <SourcePdfPage
            key={index}
            pdf={current.pdf!}
            pageNumber={index + 1}
            pageCount={pageCount}
            // The page's own column, not the whole panel, on a wide screen.
            width={Math.min(width - 24, 880)}
          />
        ))
      )}
    </div>
  );
}

/**
 * A student's own PDF, opened with pdf.js. Null while it loads; `failed` once
 * it cannot be opened. Shared by the Library reader and a sheet kept beside a
 * notebook page.
 */
export function useSourcePdfDocument(storagePath: string) {
  const [loaded, setLoaded] = useState<{
    path: string;
    pdf: PDFDocumentProxy | null;
    failed: boolean;
  } | null>(null);
  const current = loaded?.path === storagePath ? loaded : null;

  useEffect(() => {
    let disposed = false;
    let destroy: (() => Promise<void>) | null = null;
    void Promise.all([loadNotebookPdfJs(), getNotebookFileBytes(storagePath)])
      .then(async ([pdfjs, bytes]) => {
        const task = pdfjs.getDocument({ data: bytes });
        destroy = () => task.destroy();
        const pdf = await task.promise;
        if (!disposed) setLoaded({ path: storagePath, pdf, failed: false });
      })
      .catch((error) => {
        if (disposed) return;
        console.error("Source PDF could not be opened.", error);
        setLoaded({ path: storagePath, pdf: null, failed: true });
      });
    return () => {
      disposed = true;
      void destroy?.();
    };
  }, [storagePath]);

  return current
    ? { ...current, pageCount: Math.min(current.pdf?.numPages ?? 0, MAX_NOTEBOOK_PDF_PAGES) }
    : null;
}

/**
 * One page, drawn once it comes near the screen. Inside a sideways track of
 * pages, `observerRoot` is that track, so the neighbours either side are
 * drawn ahead of a swipe.
 */
export function SourcePdfPage({
  pdf,
  pageNumber,
  pageCount,
  width,
  observerRoot = null,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  pageCount: number;
  width: number;
  observerRoot?: Element | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [near, setNear] = useState(pageNumber <= 2);
  // A4 portrait until the page itself says otherwise, so the scroll length is close from the start.
  const [aspect, setAspect] = useState(297 / 210);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      // Down a scrolling column, the next screenful; across a track, a page either side.
      observerRoot ? { root: observerRoot, rootMargin: "0px 100%" } : { rootMargin: "800px 0px" }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [observerRoot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas || width <= 0) return;
    let disposed = false;
    let renderTask: RenderTask | null = null;
    void pdf
      .getPage(pageNumber)
      .then(async (page) => {
        if (disposed) return;
        const base = page.getViewport({ scale: 1 });
        setAspect(base.height / base.width);
        const metrics = getNotebookPdfRenderMetrics({
          pageWidth: base.width,
          pageHeight: base.height,
          hostWidth: width,
          hostHeight: Number.MAX_SAFE_INTEGER,
          pixelRatio: window.devicePixelRatio || 1,
        });
        canvas.width = metrics.canvasWidth;
        canvas.height = metrics.canvasHeight;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable.");
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport: page.getViewport({ scale: metrics.cssScale * metrics.pixelRatio }),
          background: "#ffffff",
        });
        await renderTask.promise;
        if (!disposed) setStatus("ready");
      })
      .catch((error) => {
        if (disposed || (error instanceof Error && error.name === "RenderingCancelledException")) {
          return;
        }
        setStatus("error");
      });
    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [near, pageNumber, pdf, width]);

  return (
    <div
      ref={hostRef}
      aria-label={`Page ${pageNumber} of ${pageCount}`}
      className="relative shrink-0 overflow-hidden rounded-sm bg-white shadow-card"
      style={{ width, height: Math.round(width * aspect) }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={`block h-full w-full transition-opacity ${
          status === "ready" ? "opacity-100" : "opacity-0"
        }`}
      />
      {status !== "ready" ? (
        <div className="absolute inset-0 grid place-items-center text-xs font-semibold text-slate-500">
          {status === "error" ? `Page ${pageNumber} could not be drawn.` : `Page ${pageNumber}`}
        </div>
      ) : null}
    </div>
  );
}
