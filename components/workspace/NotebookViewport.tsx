"use client";

import {
  memo,
  forwardRef,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
  type TransitionEventHandler,
} from "react";
import { PAGE_EDGE_CLASS } from "@/components/workspace/NotebookPageBackground";

export type NotebookViewportGeometry = {
  pageHeight: number;
  pageWidth: number;
  pageX: number;
  pageY: number;
  swipeTravel: number;
};

export type NotebookViewportPreview = {
  className: string;
  content: ReactNode;
  key: string;
};

type NotebookSheetProps = {
  children: ReactNode;
  className: string;
  dataNotebookPageSurface?: boolean;
  dataNotebookSlot: "active" | "next" | "previous";
  geometry: NotebookViewportGeometry;
  offsetX?: number;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
};

/**
 * Everything about the sheet edge except its colour, which belongs to the page
 * rather than to the sheet -- see `PAGE_COLOR_CLASS`. Naming a colour here as
 * well would leave two utilities of equal weight fighting over the same
 * property, settled by whichever Tailwind happened to emit last.
 */
const NOTEBOOK_SHEET_BASE_CLASS = `overflow-hidden rounded-sm shadow-none ${PAGE_EDGE_CLASS}`;

function getSheetStyle(
  geometry: NotebookViewportGeometry,
  offsetX = 0
) {
  return {
    width: `${geometry.pageWidth}px`,
    height: `${geometry.pageHeight}px`,
    transform: `translate3d(${geometry.pageX + offsetX}px, ${
      geometry.pageY
    }px, 0)`,
  };
}

const NotebookSheet = forwardRef<HTMLDivElement, NotebookSheetProps>(
  function NotebookSheet(
    {
      children,
      className,
      dataNotebookPageSurface = false,
      dataNotebookSlot,
      geometry,
      offsetX = 0,
      onPointerCancel,
      onPointerMove,
      onPointerUp,
    },
    ref
  ) {
    return (
      <div
        ref={ref}
        data-notebook-page-surface={
          dataNotebookPageSurface ? "true" : undefined
        }
        data-notebook-sheet="true"
        data-notebook-slot={dataNotebookSlot}
        className={`absolute left-0 top-0 ${NOTEBOOK_SHEET_BASE_CLASS} ${className}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={getSheetStyle(geometry, offsetX)}
      >
        {children}
      </div>
    );
  }
);

type Props = {
  activeClassName: string;
  activeContent: ReactNode | null;
  activeRef: Ref<HTMLDivElement>;
  frameRef: Ref<HTMLDivElement>;
  geometry: NotebookViewportGeometry;
  nextPreview?: NotebookViewportPreview | null;
  onActivePointerCancel: PointerEventHandler<HTMLDivElement>;
  onActivePointerMove: PointerEventHandler<HTMLDivElement>;
  onActivePointerUp: PointerEventHandler<HTMLDivElement>;
  onTrackTransitionCancel: TransitionEventHandler<HTMLDivElement>;
  onTrackTransitionEnd: TransitionEventHandler<HTMLDivElement>;
  overlay?: ReactNode;
  previewLayerRef: Ref<HTMLDivElement>;
  previousPreview?: NotebookViewportPreview | null;
  trackRef: Ref<HTMLDivElement>;
};

function NotebookViewport({
  activeClassName,
  activeContent,
  activeRef,
  frameRef,
  geometry,
  nextPreview,
  onActivePointerCancel,
  onActivePointerMove,
  onActivePointerUp,
  onTrackTransitionCancel,
  onTrackTransitionEnd,
  overlay,
  previewLayerRef,
  previousPreview,
  trackRef,
}: Props) {
  return (
    <div
      ref={frameRef}
      data-notebook-page-frame
      className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom,0px)] top-[env(safe-area-inset-bottom,0px)] isolate overflow-hidden"
    >
      {overlay}
      {activeContent !== null && geometry.pageWidth > 0 ? (
        <div
          ref={trackRef}
          className="notebook-page-track absolute inset-0"
          onTransitionEnd={onTrackTransitionEnd}
          onTransitionCancel={onTrackTransitionCancel}
        >
          <div
            ref={previewLayerRef}
            aria-hidden="true"
            className="invisible pointer-events-none absolute inset-0"
          >
            {previousPreview ? (
              <NotebookSheet
                key={previousPreview.key}
                className={`notebook-page-swipe-preview ${previousPreview.className}`}
                dataNotebookSlot="previous"
                geometry={geometry}
                offsetX={-geometry.swipeTravel}
              >
                {previousPreview.content}
              </NotebookSheet>
            ) : null}
            {nextPreview ? (
              <NotebookSheet
                key={nextPreview.key}
                className={`notebook-page-swipe-preview ${nextPreview.className}`}
                dataNotebookSlot="next"
                geometry={geometry}
                offsetX={geometry.swipeTravel}
              >
                {nextPreview.content}
              </NotebookSheet>
            ) : null}
          </div>
          <NotebookSheet
            ref={activeRef}
            className={`notebook-page-surface ${activeClassName}`}
            dataNotebookPageSurface
            dataNotebookSlot="active"
            geometry={geometry}
            onPointerMove={onActivePointerMove}
            onPointerUp={onActivePointerUp}
            onPointerCancel={onActivePointerCancel}
          >
            {activeContent}
          </NotebookSheet>
        </div>
      ) : null}
    </div>
  );
}

export { NOTEBOOK_SHEET_BASE_CLASS };

/**
 * Memoised: this subtree sits under the stylus and its props are now
 * stable, so a parent render no longer forces it to re-render.
 */
export default memo(NotebookViewport);
