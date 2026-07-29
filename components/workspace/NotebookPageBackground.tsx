"use client";

import Image from "next/image";
import NotebookPdfPage from "@/components/workspace/NotebookPdfPage";
import type {
  NotebookFile,
  NotebookPageColor,
  NotebookPageStyle,
} from "@/lib/workspace/notebooks";
import { getNotebookPageStyleBackground } from "@/lib/workspace/notebook-page-content";

export const PAGE_COLOR_CLASS: Record<NotebookPageColor, string> = {
  white: "bg-white text-slate-950",
  black: "bg-[#080a10] text-[#f8fafc]",
};

export default function NotebookPageBackground({
  pageColor,
  pageStyle,
  backgroundFile,
  backgroundUrl,
  pageIndex = 0,
  pdfLazy,
  pdfMaxPixelRatio,
  pdfFadeIn,
  inkSvg,
  inkSizes = "48rem",
}: {
  pageColor?: NotebookPageColor;
  pageStyle?: NotebookPageStyle;
  backgroundFile?: NotebookFile | null;
  backgroundUrl?: string;
  pageIndex?: number;
  pdfLazy?: boolean;
  pdfMaxPixelRatio?: number;
  pdfFadeIn?: boolean;
  inkSvg?: string;
  inkSizes?: string;
}) {
  return (
    <>
      {pageColor && pageStyle ? (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={getNotebookPageStyleBackground(pageColor, pageStyle)}
        />
      ) : null}
      {backgroundFile?.fileType.startsWith("image/") && backgroundUrl ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${backgroundUrl}")` }}
        />
      ) : null}
      {backgroundFile?.fileType === "application/pdf" &&
      backgroundFile.storagePath ? (
        <NotebookPdfPage
          aria-hidden="true"
          storagePath={backgroundFile.storagePath}
          pageIndex={pageIndex}
          lazy={pdfLazy}
          maxPixelRatio={pdfMaxPixelRatio}
          fadeIn={pdfFadeIn}
          className="absolute inset-0"
        />
      ) : null}
      {inkSvg ? (
        <Image
          alt=""
          aria-hidden="true"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(inkSvg)}`}
          fill
          unoptimized
          sizes={inkSizes}
          className="object-fill"
        />
      ) : null}
    </>
  );
}
