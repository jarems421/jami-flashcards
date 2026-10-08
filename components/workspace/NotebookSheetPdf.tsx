"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SourcePdfPage, useSourcePdfDocument } from "@/components/library/SourcePdfReader";
import {
  SheetBarButton,
  SheetBarDivider,
  SheetControlsBar,
  SheetZoomControls,
} from "@/components/workspace/NotebookSheetControls";
import { useSheetZoom } from "@/hooks/useSheetZoom";
import { prefersReducedMotion } from "@/lib/ui/reduced-motion";

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
 *
 * Zoomed in, the page is drawn larger and moved around by scrolling, so a
 * sideways swipe pans the page rather than turning it, and the arrows turn it.
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
  const { setHost, setScroller, zoom } = useSheetZoom();
  const zoomed = zoom.level > 1;
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
    track.scrollTo({ left: next * track.clientWidth, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  if (pdfFile?.failed) return <>{fallback}</>;

  return (
    <div ref={setHost} role="document" aria-label={`${title} PDF`} className="relative flex h-full min-h-0 flex-col">
      <div
        ref={setTrack}
        className={`flex min-h-0 flex-1 snap-x snap-mandatory overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          zoomed ? "overflow-x-hidden" : "overflow-x-auto"
        }`}
        onScroll={handleScroll}
      >
        {pdfFile?.pdf && width > 0 ? (
          Array.from({ length: pageCount }, (_, index) => (
            <div
              key={index}
              ref={index === shownPage ? setScroller : undefined}
              aria-hidden={index !== shownPage}
              className="h-full w-full shrink-0 snap-center snap-always overflow-auto overscroll-contain p-2 pb-12"
            >
              {/* Centred by its margins, not by flex: a page wider than the panel then scrolls to both edges. */}
              <div className="mx-auto w-fit" style={index === shownPage ? zoom.contentStyle : undefined}>
                <SourcePdfPage
                  pdf={pdfFile.pdf!}
                  pageNumber={index + 1}
                  pageCount={pageCount}
                  width={Math.round(Math.max(0, width - 16) * zoom.level)}
                  observerRoot={observerRoot}
                />
              </div>
            </div>
          ))
        ) : (
          <div role="status" className="grid w-full place-items-center text-sm font-semibold text-text-muted">
            Loading PDF…
          </div>
        )}
      </div>
      {ready ? (
        <SheetControlsBar>
          <SheetZoomControls zoom={zoom} />
          {pageCount > 1 ? (
            <>
              <SheetBarDivider />
              <SheetBarButton label="Previous page" disabled={shownPage === 0} onClick={() => goTo(shownPage - 1)}>
                <path d="m12.5 5-5 5 5 5" />
              </SheetBarButton>
              <span className="min-w-[3.25rem] shrink-0 px-1 text-center text-2xs font-semibold tabular-nums text-text-secondary" aria-live="polite">
                {shownPage + 1} / {pageCount}
              </span>
              <SheetBarButton label="Next page" disabled={shownPage >= pageCount - 1} onClick={() => goTo(shownPage + 1)}>
                <path d="m7.5 5 5 5-5 5" />
              </SheetBarButton>
            </>
          ) : null}
        </SheetControlsBar>
      ) : null}
    </div>
  );
}
