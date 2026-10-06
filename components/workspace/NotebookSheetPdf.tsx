"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SourcePdfPage, useSourcePdfDocument } from "@/components/library/SourcePdfReader";

/** Quiet time after a swipe before the page it settled on counts as the page. */
const SETTLE_MS = 110;

/**
 * A PDF kept beside the page, one page at a time: swipe sideways for the next
 * page, scroll down a page that is taller than the panel.
 *
 * One page at a time because a sheet beside the page is read a question at a
 * time, and a long column of pages loses the student's place every time the
 * panel is resized. The track snaps to a page per swipe; the arrows do the
 * same for a mouse or a keyboard, and the counter says where they are.
 */
export default function NotebookSheetPdf({
  storagePath,
  title,
  fallback,
  initialPage = 0,
  onPageChange,
}: {
  storagePath: string;
  title: string;
  /** Shown when the file cannot be opened. */
  fallback: React.ReactNode;
  /** Where the student left this sheet, counted from 0. */
  initialPage?: number;
  onPageChange?: (page: number) => void;
}) {
  const pdfFile = useSourcePdfDocument(storagePath);
  const trackRef = useRef<HTMLDivElement | null>(null);
  // The same element, as state: the pages watch it to draw their neighbours.
  const [observerRoot, setObserverRoot] = useState<HTMLDivElement | null>(null);
  const setTrack = useCallback((element: HTMLDivElement | null) => {
    trackRef.current = element;
    setObserverRoot(element);
  }, []);
  const [width, setWidth] = useState(0);
  const pageCount = pdfFile?.pageCount ?? 0;
  const [page, setPage] = useState(initialPage);
  const shownPage = pageCount > 0 ? Math.min(page, pageCount - 1) : 0;
  const pageRef = useRef(shownPage);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPageChangeRef = useRef(onPageChange);
  useLayoutEffect(() => {
    pageRef.current = shownPage;
    onPageChangeRef.current = onPageChange;
  });

  // A resize keeps the page in view: the track's offset is in pixels, the page is not.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.round(entry?.contentRect.width ?? track.clientWidth));
      track.scrollLeft = pageRef.current * track.clientWidth;
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [observerRoot]);

  // Opens on the page the student left it at, once there are pages to be on.
  const ready = pageCount > 0 && width > 0;
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (ready && track) track.scrollLeft = pageRef.current * track.clientWidth;
  }, [ready]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    []
  );

  const handleScroll = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const track = trackRef.current;
      if (!track || track.clientWidth === 0) return;
      const settled = Math.max(0, Math.min(pageCount - 1, Math.round(track.scrollLeft / track.clientWidth)));
      if (settled === pageRef.current) return;
      setPage(settled);
      onPageChangeRef.current?.(settled);
    }, SETTLE_MS);
  };

  const goTo = (target: number) => {
    const track = trackRef.current;
    if (!track) return;
    const next = Math.max(0, Math.min(pageCount - 1, target));
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: next * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
  };

  if (pdfFile?.failed) return <>{fallback}</>;

  return (
    <div role="document" aria-label={`${title} PDF`} className="relative flex h-full min-h-0 flex-col">
      <div
        ref={setTrack}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={handleScroll}
      >
        {pdfFile?.pdf && width > 0 ? (
          Array.from({ length: pageCount }, (_, index) => (
            <div
              key={index}
              aria-hidden={index !== shownPage}
              className="flex h-full w-full shrink-0 snap-center snap-always justify-center overflow-y-auto p-2 pb-12"
            >
              <SourcePdfPage
                pdf={pdfFile.pdf!}
                pageNumber={index + 1}
                pageCount={pageCount}
                width={Math.max(0, width - 16)}
                observerRoot={observerRoot}
              />
            </div>
          ))
        ) : (
          <div role="status" className="grid w-full place-items-center text-sm font-semibold text-text-muted">
            Loading PDF…
          </div>
        )}
      </div>
      {ready && pageCount > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-0.5 shadow-e1">
            <PageButton label="Previous page" disabled={shownPage === 0} onClick={() => goTo(shownPage - 1)}>
              <path d="m12.5 5-5 5 5 5" />
            </PageButton>
            <span className="min-w-[3.25rem] px-1 text-center text-2xs font-semibold tabular-nums text-text-secondary" aria-live="polite">
              {shownPage + 1} / {pageCount}
            </span>
            <PageButton label="Next page" disabled={shownPage >= pageCount - 1} onClick={() => goTo(shownPage + 1)}>
              <path d="m7.5 5 5 5-5 5" />
            </PageButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="inline-grid h-8 w-8 place-items-center rounded-full text-text-secondary transition duration-fast hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:opacity-35 disabled:hover:bg-transparent"
      onClick={onClick}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        {children}
      </svg>
    </button>
  );
}
