"use client";

import { useState } from "react";
import Image from "next/image";
import type { Source } from "@/lib/practice/sources";
import {
  getSourceFileKind,
  getSourceFileTypeLabel,
} from "@/lib/practice/source-files";

type SourcePreviewProps = {
  source: Source;
  fileUrl?: string;
};

type PreviewLoadState = "loading" | "ready" | "error";

const readerCanvasClass =
  "h-full w-full overflow-hidden bg-[var(--color-surface-panel-strong)]";
const readerMinHeightClass =
  "min-h-[20rem] sm:min-h-[28rem] lg:min-h-[36rem]";
const mediaViewportClass = "h-[clamp(22rem,68vh,48rem)]";

function FileGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3.5h6.5L18 8v12.5H7z" />
      <path d="M13.5 3.5V8H18M9.75 12.25h5M9.75 15.75h5" />
    </svg>
  );
}

function PreviewState({
  title,
  description,
  fileName,
  fileType,
  loading = false,
}: {
  title: string;
  description: string;
  fileName?: string;
  fileType?: string;
  loading?: boolean;
}) {
  return (
    <div className="flex max-w-sm flex-col items-center px-6 text-center">
      {loading ? (
        <span
          aria-hidden="true"
          className="h-6 w-6 rounded-full border-2 border-[var(--color-border-strong)] border-t-[var(--color-text-secondary)] motion-safe:animate-spin"
        />
      ) : (
        <FileGlyph className="h-8 w-8 text-text-muted" />
      )}
      <div className="mt-4 text-sm font-semibold text-text-primary">
        {title}
      </div>
      {fileName ? (
        <div className="mt-2 max-w-full truncate text-sm text-text-secondary">
          {fileName}
        </div>
      ) : null}
      {fileType ? (
        <div className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
          {fileType}
        </div>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-text-muted">{description}</p>
    </div>
  );
}

export default function SourcePreview({ source, fileUrl }: SourcePreviewProps) {
  const fileKind = getSourceFileKind(source.fileType);
  const previewKey = `${source.id}:${fileKind ?? "file"}:${fileUrl ?? "pending"}`;
  const [loadState, setLoadState] = useState<{
    key: string;
    status: PreviewLoadState;
  }>({ key: "", status: "loading" });
  const previewStatus =
    loadState.key === previewKey ? loadState.status : "loading";

  if (source.contentText) {
    return (
      <div
        role="document"
        aria-label={`${source.title} text preview`}
        tabIndex={0}
        className={`${readerMinHeightClass} min-h-full w-full bg-[var(--color-surface-panel-strong)] px-5 py-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-selected-border)] sm:px-8 sm:py-9`}
      >
        <div className="mx-auto max-w-[46rem] whitespace-pre-wrap break-words text-[0.95rem] leading-[1.8] text-text-secondary sm:text-base">
          {source.contentText}
        </div>
      </div>
    );
  }

  if (source.type === "link" && source.externalUrl) {
    return (
      <div
        aria-label={`${source.title} link preview`}
        className={`${readerMinHeightClass} min-h-full w-full bg-[var(--color-surface-panel-strong)] px-5 py-7 sm:px-8 sm:py-9`}
      >
        <div className="mx-auto w-full max-w-[46rem]">
          <div className="break-all text-[0.95rem] leading-[1.8] text-text-secondary sm:text-base">
            {source.externalUrl}
          </div>
        </div>
      </div>
    );
  }

  if (
    (fileKind === "image" || fileKind === "pdf") &&
    source.storagePath &&
    fileUrl === undefined
  ) {
    return (
      <div
        role="status"
        className={`${readerCanvasClass} ${mediaViewportClass} flex items-center justify-center`}
      >
        <PreviewState
          loading
          title="Preparing preview"
          description="Loading the saved file."
          fileName={source.fileName}
          fileType={getSourceFileTypeLabel(source.fileType)}
        />
      </div>
    );
  }

  if (fileKind === "image" && fileUrl) {
    return (
      <div
        className={`${readerCanvasClass} ${mediaViewportClass} relative flex items-center justify-center`}
      >
        {previewStatus !== "ready" ? (
          <div
            role="status"
            className="absolute inset-0 z-0 flex items-center justify-center"
          >
            <PreviewState
              loading={previewStatus === "loading"}
              title={
                previewStatus === "loading"
                  ? "Loading image"
                  : "Preview unavailable"
              }
              description={
                previewStatus === "loading"
                  ? "Preparing the image preview."
                  : "The saved image could not be displayed."
              }
              fileName={source.fileName}
              fileType={getSourceFileTypeLabel(source.fileType)}
            />
          </div>
        ) : null}
        {previewStatus !== "error" ? (
          <Image
            key={previewKey}
            src={fileUrl}
            alt={source.title}
            width={1200}
            height={900}
            sizes="(max-width: 1024px) 100vw, 60vw"
            unoptimized
            onLoad={() => setLoadState({ key: previewKey, status: "ready" })}
            onError={() => setLoadState({ key: previewKey, status: "error" })}
            className={`relative z-10 max-h-full w-auto max-w-full object-contain transition-opacity duration-200 motion-reduce:transition-none ${
              previewStatus === "ready" ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : null}
      </div>
    );
  }

  if (fileKind === "pdf" && fileUrl) {
    return (
      <div className={`${readerCanvasClass} min-h-[22rem] relative`}>
        {previewStatus !== "ready" ? (
          <div
            role="status"
            className="absolute inset-0 z-0 flex items-center justify-center"
          >
            <PreviewState
              loading
              title="Loading PDF"
              description="Preparing the document preview."
              fileName={source.fileName}
              fileType={getSourceFileTypeLabel(source.fileType)}
            />
          </div>
        ) : null}
        <iframe
          key={previewKey}
          src={fileUrl}
          title={`${source.title} PDF preview`}
          loading="lazy"
          onLoad={() => setLoadState({ key: previewKey, status: "ready" })}
          className={`relative z-10 h-full w-full border-0 bg-white transition-opacity duration-200 motion-reduce:transition-none ${
            previewStatus === "ready" ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
    );
  }

  if (source.fileName) {
    const previewFailed =
      (fileKind === "image" || fileKind === "pdf") && fileUrl === "";

    return (
      <div
        className={`${readerCanvasClass} ${readerMinHeightClass} flex items-center justify-center`}
      >
        <PreviewState
          title={previewFailed ? "Preview unavailable" : "Original file saved"}
          description={
            previewFailed
              ? "The preview could not be loaded. Try again in a moment."
              : "Open the original to view this document."
          }
          fileName={source.fileName}
          fileType={getSourceFileTypeLabel(source.fileType)}
        />
      </div>
    );
  }

  return (
    <div
      className={`${readerCanvasClass} ${readerMinHeightClass} flex items-center justify-center px-6 text-center`}
    >
      <PreviewState
        title="No preview available"
        description="This source does not contain any previewable content yet."
      />
    </div>
  );
}
