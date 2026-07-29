"use client";

import { memo } from "react";
import NotebookPageBackground from "@/components/workspace/NotebookPageBackground";
import type {
  Notebook,
  NotebookFile,
  NotebookPage,
} from "@/lib/workspace/notebooks";
import {
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
} from "@/lib/workspace/notebooks";
import { legacyStrokesToJsDrawSvg } from "@/lib/workspace/notebook-ink-data";
import { normalizeNotebookStrokes } from "@/lib/workspace/notebook-page-content";

// Full-size, non-interactive render of a page's saved content (style, background
// file, ink SVG, text blocks). Used as the swipe preview so the real adjacent
// page is visible while dragging, instead of a blank placeholder that only fills
// in after the editor remounts.
const NotebookPageStaticContent = memo(function NotebookPageStaticContent({
  page,
  notebook,
  backgroundFile,
  backgroundUrl,
}: {
  page: NotebookPage;
  notebook: Notebook | null;
  backgroundFile: NotebookFile | null;
  backgroundUrl?: string;
}) {
  const pageColor = page.pageColor ?? notebook?.pageColor ?? "white";
  const pageStyle = page.pageStyle ?? notebook?.pageStyle ?? "plain";
  const inkSvg =
    page.inkData?.svg ??
    legacyStrokesToJsDrawSvg(
      normalizeNotebookStrokes(page.strokeData?.strokes),
      NOTEBOOK_PAGE_COORDINATE_WIDTH,
      NOTEBOOK_PAGE_COORDINATE_HEIGHT
    );
  const hasInk =
    Boolean(page.inkData?.svg) || (page.strokeData?.strokes?.length ?? 0) > 0;

  return (
    <>
      <NotebookPageBackground
        pageColor={pageColor}
        pageStyle={pageStyle}
        backgroundFile={backgroundFile}
        backgroundUrl={backgroundUrl}
        pageIndex={page.pdfPageIndex ?? 0}
        pdfLazy={false}
        pdfFadeIn={false}
        inkSvg={hasInk ? inkSvg : undefined}
        inkSizes="48rem"
      />
      {page.textBlocks.map((block) => (
        <div
          key={block.id}
          aria-hidden="true"
          className={`absolute overflow-hidden rounded-[0.45rem] border bg-transparent ${
            block.outlineVisible
              ? pageColor === "black"
                ? "border-white/30"
                : "border-slate-950/25"
              : "border-transparent"
          }`}
          style={{
            left: `${(block.x / NOTEBOOK_PAGE_COORDINATE_WIDTH) * 100}%`,
            top: `${(block.y / NOTEBOOK_PAGE_COORDINATE_HEIGHT) * 100}%`,
            width: `${(block.width / NOTEBOOK_PAGE_COORDINATE_WIDTH) * 100}%`,
            height: `${(block.height / NOTEBOOK_PAGE_COORDINATE_HEIGHT) * 100}%`,
          }}
        >
          <div
            className={`h-full w-full overflow-hidden whitespace-pre-wrap rounded-[0.45rem] p-2 pr-10 text-sm font-medium leading-6 ${
              pageColor === "black" ? "text-[#f8fafc]" : "text-slate-950"
            }`}
          >
            {block.text}
          </div>
        </div>
      ))}
    </>
  );
});

export default NotebookPageStaticContent;
