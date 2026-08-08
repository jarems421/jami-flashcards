"use client";

import NotebookPageBackground, {
  PAGE_COLOR_CLASS,
} from "@/components/workspace/NotebookPageBackground";
import type {
  Notebook,
  NotebookFile,
  NotebookPage,
} from "@/lib/workspace/notebooks";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";
import {
  buildNotebookThumbnailPoints,
  getNotebookPageStyleBackground,
  getNotebookStrokePaintColorForPage,
  normalizeNotebookStrokes,
} from "@/lib/workspace/notebook-page-content";
import { orderNotebookStrokesForRendering } from "@/lib/workspace/notebook-rendering";
import { resolveNotebookPageThumbnail } from "@/lib/workspace/notebook-page-ink-split";

export default function NotebookPageThumbnail({
  page,
  notebook,
  backgroundFile,
  backgroundUrl,
}: {
  page: NotebookPage;
  notebook: Notebook;
  backgroundFile?: NotebookFile;
  backgroundUrl?: string;
}) {
  const pageColor = page.pageColor ?? notebook.pageColor ?? "white";
  const pageStyle = page.pageStyle ?? notebook.pageStyle ?? "plain";
  // Reads the stored digest for a split page and the real ink for a legacy or
  // already-loaded one, so the drawer never fetches ink to draw a preview.
  const preview = resolveNotebookPageThumbnail(page);
  const strokes = normalizeNotebookStrokes(preview.strokes).slice(0, 10);
  const textBlocks = page.textBlocks.slice(0, 3);
  const inkSvg = preview.inkSvg;

  return (
    <div
      className={`relative aspect-[900/1240] overflow-hidden rounded-sm shadow-sm ${PAGE_COLOR_CLASS[pageColor]}`}
      style={getNotebookPageStyleBackground(pageColor, pageStyle)}
    >
      <NotebookPageBackground
        backgroundFile={backgroundFile}
        backgroundUrl={backgroundUrl}
        pageIndex={page.pdfPageIndex ?? 0}
        pdfLazy
        pdfMaxPixelRatio={1.25}
        inkSvg={inkSvg}
        inkSizes="10rem"
      />
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${NOTEBOOK_PAGE_COORDINATE_WIDTH} ${NOTEBOOK_PAGE_COORDINATE_HEIGHT}`}
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        {orderNotebookStrokesForRendering(strokes).map((stroke, index) =>
          stroke.points.length === 1 ? (
            <circle
              key={`${page.id}-stroke-${index}`}
              cx={stroke.points[0].x}
              cy={stroke.points[0].y}
              r={Math.max(3, stroke.width * 1.7)}
              fill={getNotebookStrokePaintColorForPage(stroke, pageColor)}
              opacity={stroke.tool === "highlighter" ? 0.32 : 0.72}
            />
          ) : (
            <polyline
              key={`${page.id}-stroke-${index}`}
              points={buildNotebookThumbnailPoints(stroke.points)}
              fill="none"
              stroke={getNotebookStrokePaintColorForPage(stroke, pageColor)}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={Math.max(5, stroke.width * 2.3)}
              opacity={stroke.tool === "highlighter" ? 0.32 : 0.72}
            />
          )
        )}
      </svg>
      <div className="absolute inset-0">
        {textBlocks.map((block) => (
          <div
            key={`${page.id}-${block.id}`}
            /*
             * Below the type scale's floor on purpose, and the one place that
             * is right: this is a thumbnail of a page, so the text stands in
             * for text at that scale rather than being read. Sizing it to the
             * floor would make a page of notes look like three enormous words.
             */
            // eslint-disable-next-line no-restricted-syntax
            className={`absolute overflow-hidden rounded-sm border-[0.5px] px-1 text-[0.34rem] font-semibold leading-tight ${
              pageColor === "black"
                ? "text-[#f8fafc]/80"
                : "text-slate-950/75"
            } ${
              block.outlineVisible
                ? pageColor === "black"
                  ? "border-white/25"
                  : "border-slate-950/20"
                : "border-transparent"
            }`}
            style={{
              left: `${(block.x / NOTEBOOK_PAGE_COORDINATE_WIDTH) * 100}%`,
              top: `${(block.y / NOTEBOOK_PAGE_COORDINATE_HEIGHT) * 100}%`,
              width: `${(block.width / NOTEBOOK_PAGE_COORDINATE_WIDTH) * 100}%`,
              maxHeight: `${(block.height / NOTEBOOK_PAGE_COORDINATE_HEIGHT) * 100}%`,
            }}
          >
            {block.text.trim().slice(0, 34)}
          </div>
        ))}
      </div>
      <div
        className={`absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5 text-2xs font-semibold leading-none tabular-nums backdrop-blur-sm ${
          pageColor === "black"
            ? "bg-white/15 text-[#f8fafc]"
            : "bg-slate-950/55 text-white"
        }`}
      >
        {page.pageNumber}
      </div>
    </div>
  );
}
