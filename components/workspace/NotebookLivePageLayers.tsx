"use client";

import Image from "next/image";
import { memo, type ComponentPropsWithoutRef, type Ref } from "react";
import {
  NotebookInkEditor,
  type NotebookInkEditorHandle,
} from "@/components/workspace/NotebookInkEditor";
import NotebookPageBackground from "@/components/workspace/NotebookPageBackground";
import {
  NOTEBOOK_ERASER_THICKNESS_BY_SIZE,
  type NotebookEraserSize,
} from "@/lib/workspace/notebook-eraser";

export type NotebookLivePageBackgroundProps = Omit<
  ComponentPropsWithoutRef<typeof NotebookPageBackground>,
  | "fileLayerClassName"
  | "inkClassName"
  | "inkSizes"
  | "inkSvg"
  | "pageStyleClassName"
>;

export type NotebookLiveInkEditorProps = Omit<
  ComponentPropsWithoutRef<typeof NotebookInkEditor>,
  | "eraserThickness"
  | "initialSvg"
  | "pageHeight"
  | "pageId"
  | "pageWidth"
  | "readOnly"
>;

export type NotebookSwipeInkSnapshot = {
  pageId: string;
  svg: string;
};

export type NotebookLivePageLayersProps = {
  backgroundProps: NotebookLivePageBackgroundProps;
  editingEnabled: boolean;
  eraserWidth: NotebookEraserSize;
  hasPersistedInk: boolean;
  inkEditorMountRevision: number;
  inkEditorProps: NotebookLiveInkEditorProps;
  inkEditorRef: Ref<NotebookInkEditorHandle>;
  inkReady: boolean;
  onSwipeInkSnapshotReady(pageId: string): void;
  pageHeight: number;
  pageId: string;
  pageWidth: number;
  persistedInkSvg: string;
  swipeInkSnapshot: NotebookSwipeInkSnapshot | null;
};

export function NotebookLivePageLayers({
  backgroundProps,
  editingEnabled,
  eraserWidth,
  hasPersistedInk,
  inkEditorMountRevision,
  inkEditorProps,
  inkEditorRef,
  inkReady,
  onSwipeInkSnapshotReady,
  pageHeight,
  pageId,
  pageWidth,
  persistedInkSvg,
  swipeInkSnapshot,
}: NotebookLivePageLayersProps) {
  const matchingSwipeInkSnapshot =
    swipeInkSnapshot?.pageId === pageId ? swipeInkSnapshot : null;

  return (
    <>
      <NotebookPageBackground
        {...backgroundProps}
        pageStyleClassName="pointer-events-none absolute inset-0 z-0"
        fileLayerClassName="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center overflow-hidden"
        inkSvg={
          !inkReady && hasPersistedInk ? persistedInkSvg : undefined
        }
        inkSizes="48rem"
        inkClassName="pointer-events-none absolute inset-0 z-[12] object-fill"
      />
      <NotebookInkEditor
        {...inkEditorProps}
        ref={inkEditorRef}
        key={`${pageId}:${inkEditorMountRevision}`}
        pageId={pageId}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        initialSvg={persistedInkSvg}
        eraserThickness={NOTEBOOK_ERASER_THICKNESS_BY_SIZE[eraserWidth]}
        readOnly={!editingEnabled}
      />
      {matchingSwipeInkSnapshot ? (
        <Image
          alt=""
          aria-hidden="true"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(
            matchingSwipeInkSnapshot.svg
          )}`}
          fill
          unoptimized
          sizes="48rem"
          className="notebook-page-swipe-ink-snapshot pointer-events-none absolute inset-0 z-[25] object-fill"
          onLoad={() =>
            onSwipeInkSnapshotReady(matchingSwipeInkSnapshot.pageId)
          }
        />
      ) : null}
    </>
  );
}

/**
 * Memoised: this subtree sits under the stylus and its props are now
 * stable, so a parent render no longer forces it to re-render.
 */
export default memo(NotebookLivePageLayers);
