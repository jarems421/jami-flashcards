"use client";

import Image from "next/image";
import NotebookPdfPage, {
  type NotebookPdfRenderState,
} from "@/components/workspace/NotebookPdfPage";
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
  pageStyleClassName = "absolute inset-0",
  fileLayerClassName,
  imageStrategy = "css",
  imageRenderKey,
  imageOnSettled,
  imageLoadingLabel,
  imageSizes = "48rem",
  imageClassName = "object-contain",
  pdfLazy,
  pdfMaxPixelRatio,
  pdfFadeIn,
  pdfRenderKey,
  pdfAriaHidden = true,
  pdfAriaLabel,
  pdfOnRenderStateChange,
  pdfOnCanvasReady,
  inkSvg,
  inkSizes = "48rem",
  inkClassName = "object-fill",
}: {
  pageColor?: NotebookPageColor;
  pageStyle?: NotebookPageStyle;
  backgroundFile?: NotebookFile | null;
  backgroundUrl?: string;
  pageIndex?: number;
  pageStyleClassName?: string;
  fileLayerClassName?: string;
  imageStrategy?: "css" | "next-image";
  imageRenderKey?: string;
  imageOnSettled?: () => void;
  imageLoadingLabel?: string;
  imageSizes?: string;
  imageClassName?: string;
  pdfLazy?: boolean;
  pdfMaxPixelRatio?: number;
  pdfFadeIn?: boolean;
  pdfRenderKey?: string;
  pdfAriaHidden?: boolean;
  pdfAriaLabel?: string;
  pdfOnRenderStateChange?: (state: NotebookPdfRenderState) => void;
  pdfOnCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  inkSvg?: string;
  inkSizes?: string;
  inkClassName?: string;
}) {
  const fileContent =
    backgroundFile?.fileType.startsWith("image/") ? (
      imageStrategy === "next-image" ? (
        backgroundUrl ? (
          <Image
            key={imageRenderKey}
            alt=""
            aria-hidden="true"
            src={backgroundUrl}
            fill
            unoptimized
            sizes={imageSizes}
            className={imageClassName}
            onLoad={imageOnSettled}
            onError={imageOnSettled}
          />
        ) : imageLoadingLabel ? (
          <div className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-3 py-1 text-xs font-semibold text-text-secondary">
            {imageLoadingLabel}
          </div>
        ) : null
      ) : backgroundUrl ? (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${backgroundUrl}")` }}
        />
      ) : null
    ) : backgroundFile?.fileType === "application/pdf" &&
      backgroundFile.storagePath ? (
      <NotebookPdfPage
        key={pdfRenderKey}
        aria-hidden={pdfAriaHidden ? "true" : undefined}
        aria-label={pdfAriaLabel}
        storagePath={backgroundFile.storagePath}
        pageIndex={pageIndex}
        lazy={pdfLazy}
        maxPixelRatio={pdfMaxPixelRatio}
        fadeIn={pdfFadeIn}
        onRenderStateChange={pdfOnRenderStateChange}
        onCanvasReady={pdfOnCanvasReady}
        className="absolute inset-0"
      />
    ) : null;

  return (
    <>
      {pageColor && pageStyle ? (
        <div
          aria-hidden="true"
          className={pageStyleClassName}
          style={getNotebookPageStyleBackground(pageColor, pageStyle)}
        />
      ) : null}
      {fileLayerClassName && backgroundFile ? (
        <div className={fileLayerClassName}>{fileContent}</div>
      ) : (
        fileContent
      )}
      {inkSvg ? (
        <Image
          alt=""
          aria-hidden="true"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(inkSvg)}`}
          fill
          unoptimized
          sizes={inkSizes}
          className={inkClassName}
        />
      ) : null}
    </>
  );
}
