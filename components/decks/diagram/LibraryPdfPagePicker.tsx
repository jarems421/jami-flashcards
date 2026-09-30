"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from "@/components/ui";
import type { Source } from "@/lib/material/sources";
import { renderPdfPagePicture, type DiagramPicture } from "@/lib/study/diagram-image";
import {
  getNotebookPdfRenderMetrics,
  loadNotebookPdfJs,
  MAX_NOTEBOOK_PDF_PAGES,
} from "@/lib/workspace/notebook-pdf";
import { getNotebookFileBytes } from "@/services/study/notebook-files";
import { getActiveSources } from "@/services/study/sources";

type LibraryPdfPagePickerProps = {
  open: boolean;
  userId: string;
  onClose: () => void;
  onPicture: (picture: DiagramPicture) => void;
};

function isPdfSource(source: Source) {
  return (
    source.type === "file" &&
    Boolean(source.storagePath) &&
    (source.fileType === "application/pdf" || source.fileName?.toLowerCase().endsWith(".pdf") === true)
  );
}

const THUMB_WIDTH = 168;

/** One page, drawn small once it scrolls near, to pick by eye. */
function PageThumbnail({
  pdf,
  pageNumber,
  busy,
  onPick,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  busy: boolean;
  onPick: () => void;
}) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(pageNumber <= 6);
  const [aspect, setAspect] = useState(297 / 210);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: "400px 0px" }
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas) return;
    let disposed = false;
    let task: RenderTask | null = null;
    void pdf
      .getPage(pageNumber)
      .then(async (page) => {
        if (disposed) return;
        const base = page.getViewport({ scale: 1 });
        setAspect(base.height / base.width);
        const metrics = getNotebookPdfRenderMetrics({
          pageWidth: base.width,
          pageHeight: base.height,
          hostWidth: THUMB_WIDTH,
          hostHeight: Number.MAX_SAFE_INTEGER,
          pixelRatio: window.devicePixelRatio || 1,
        });
        canvas.width = metrics.canvasWidth;
        canvas.height = metrics.canvasHeight;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        task = page.render({
          canvas,
          canvasContext: context,
          viewport: page.getViewport({ scale: metrics.cssScale * metrics.pixelRatio }),
          background: "#ffffff",
        });
        await task.promise;
        if (!disposed) setReady(true);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      task?.cancel();
    };
  }, [near, pageNumber, pdf]);

  return (
    <button
      ref={hostRef}
      type="button"
      disabled={busy}
      onClick={onPick}
      aria-label={`Use page ${pageNumber}`}
      className="group flex flex-col items-center gap-1.5 rounded-xl p-1.5 text-xs text-text-muted transition hover:bg-[var(--color-glass-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-selected-border)] disabled:opacity-60"
    >
      <span
        className="relative block w-full overflow-hidden rounded-md bg-white shadow-card ring-accent transition group-hover:ring-2"
        style={{ aspectRatio: `1 / ${aspect}` }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className={`block h-full w-full transition-opacity ${ready ? "opacity-100" : "opacity-0"}`}
        />
      </span>
      <span>Page {pageNumber}</span>
    </button>
  );
}

/**
 * A page of a Library PDF, as the picture for a diagram.
 *
 * Lecture slides are where most diagrams already are. The student picks the
 * PDF, then the page; the page is drawn as a picture and cropped next. The PDF
 * is only read, never changed, and nothing is read until they choose it.
 */
export default function LibraryPdfPagePicker({ open, userId, onClose, onPicture }: LibraryPdfPagePickerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [chosen, setChosen] = useState<Source | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "rendering" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    getActiveSources(userId)
      .then((all) => {
        if (active) setSources(all.filter(isPdfSource));
      })
      .catch(() => {
        if (active) {
          setSources([]);
          setError("Your Library could not be loaded. Try again in a moment.");
        }
      });
    return () => {
      active = false;
    };
  }, [open, userId]);

  useEffect(() => {
    if (!chosen?.storagePath) return;
    let disposed = false;
    let destroy: (() => Promise<void>) | null = null;
    void Promise.all([loadNotebookPdfJs(), getNotebookFileBytes(chosen.storagePath)])
      .then(async ([pdfjs, bytes]) => {
        const task = pdfjs.getDocument({ data: bytes });
        destroy = () => task.destroy();
        const document = await task.promise;
        if (disposed) return;
        setPdf(document);
        setStatus("idle");
      })
      .catch(() => {
        if (disposed) return;
        setStatus("error");
        setError("This PDF could not be opened.");
      });
    return () => {
      disposed = true;
      void destroy?.();
    };
  }, [chosen]);

  const choose = (source: Source | null) => {
    setChosen(source);
    setPdf(null);
    setError(null);
    setStatus(source ? "loading" : "idle");
  };

  const close = () => {
    choose(null);
    setSources(null);
    onClose();
  };

  const pick = async (pageNumber: number) => {
    if (!pdf || !chosen) return;
    setStatus("rendering");
    setError(null);
    try {
      const picture = await renderPdfPagePicture(pdf, pageNumber, chosen.title);
      choose(null);
      setSources(null);
      onPicture(picture);
    } catch (pickError) {
      console.error("Failed to draw a PDF page for a diagram.", pickError);
      setStatus("error");
      setError("That page could not be drawn. Try another.");
    }
  };

  const pageCount = Math.min(pdf?.numPages ?? 0, MAX_NOTEBOOK_PDF_PAGES);

  return (
    <Dialog
      open={open}
      initialFocusRef={closeRef}
      closeOnBackdrop={status !== "rendering"}
      className="fixed inset-0 grid place-items-center p-3 sm:p-6"
      onDismiss={close}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <DialogPanel className="relative flex max-h-[min(88vh,52rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] shadow-e3">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold text-text-primary">
              {chosen ? chosen.title : "Use a page from your Library"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-text-secondary">
              {chosen ? "Pick the page with the diagram. You crop it next." : "Choose a PDF, such as lecture slides."}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            {chosen ? (
              <Button type="button" size="sm" variant="ghost" disabled={status === "rendering"} onClick={() => choose(null)}>
                Back
              </Button>
            ) : null}
            <Button ref={closeRef} type="button" size="sm" variant="ghost" disabled={status === "rendering"} onClick={close}>
              Close
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {error ? (
            <p role="alert" className="app-danger mb-3 rounded-xl px-4 py-3 text-sm">
              {error}
            </p>
          ) : null}
          {!chosen ? (
            sources === null ? (
              <p role="status" className="py-10 text-center text-sm text-text-muted">Loading your Library…</p>
            ) : sources.length === 0 ? (
              <p className="py-10 text-center text-sm leading-6 text-text-secondary">
                No PDFs in your Library yet. Add lecture slides or notes as a PDF source, or upload a picture instead.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {sources.map((source) => (
                  <li key={source.id}>
                    <button
                      type="button"
                      onClick={() => choose(source)}
                      className="flex w-full items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-left transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-selected-border)]"
                    >
                      <span aria-hidden="true" className="grid h-9 w-8 shrink-0 place-items-center rounded-md bg-white text-2xs font-bold text-accent shadow-card">
                        PDF
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-text-primary">{source.title}</span>
                        {source.fileName ? (
                          <span className="block truncate text-xs text-text-muted">{source.fileName}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : !pdf ? (
            <p role="status" className="py-10 text-center text-sm text-text-muted">
              {status === "error" ? null : "Opening the PDF…"}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {Array.from({ length: pageCount }, (_, index) => (
                <PageThumbnail
                  key={index}
                  pdf={pdf}
                  pageNumber={index + 1}
                  busy={status === "rendering"}
                  onPick={() => void pick(index + 1)}
                />
              ))}
            </div>
          )}
        </div>
        {status === "rendering" ? (
          <p role="status" className="border-t border-[var(--color-border)] px-6 py-3 text-sm text-text-secondary">
            Drawing the page…
          </p>
        ) : null}
      </DialogPanel>
    </Dialog>
  );
}
