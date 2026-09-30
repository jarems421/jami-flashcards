"use client";

import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { FloatingResizeEdges } from "@/lib/ui/floating-panel";

type ResizeHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick?: (event: ReactMouseEvent<HTMLElement>) => void;
};

type FloatingResizeHandlesProps = {
  getHandleProps: (edges: FloatingResizeEdges) => ResizeHandleProps;
};

/*
 * Handles for resizing a floating panel from anywhere on its edge, the way a
 * window or an image is resized.
 *
 * The whole perimeter takes a drag. Each side is one strip running its full
 * length, and the corners sit over the strips' ends, so there is nowhere along
 * the edge that does nothing. The strips used to stop short of the corners and
 * were 16px deep, a third of a fingertip, so on a tablet a finger reaching for
 * a side mostly missed it and the corners felt like the only way to resize --
 * and a corner is the hardest place to change just the width.
 *
 * Every hit area reaches 24px outside the panel, where there is nothing else
 * to hit, and only a little way in, clear of the panel's own controls. The top
 * strip reaches in least: just inside it is the header's grab bar, which moves
 * the panel rather than resizing it.
 *
 * Nothing is drawn. The panel's outline is the handle, and it lights up while
 * a resize is under way -- that is the panel's job, not this one's. Corner arcs
 * and edge grips were tried, and read as clutter round a card whose edge
 * already says it can be pulled.
 */
const EDGES: Array<{ name: string; edges: FloatingResizeEdges; className: string }> = [
  { name: "top", edges: { top: true }, className: "inset-x-0 -top-6 h-7 cursor-ns-resize" },
  { name: "bottom", edges: { bottom: true }, className: "inset-x-0 -bottom-6 h-8 cursor-ns-resize" },
  { name: "left", edges: { left: true }, className: "inset-y-0 -left-6 w-8 cursor-ew-resize" },
  { name: "right", edges: { right: true }, className: "inset-y-0 -right-6 w-8 cursor-ew-resize" },
];

const CORNERS: Array<{ name: string; edges: FloatingResizeEdges; className: string }> = [
  { name: "top left", edges: { top: true, left: true }, className: "-left-6 -top-6 cursor-nwse-resize" },
  { name: "top right", edges: { top: true, right: true }, className: "-right-6 -top-6 cursor-nesw-resize" },
  { name: "bottom left", edges: { bottom: true, left: true }, className: "-bottom-6 -left-6 cursor-nesw-resize" },
  { name: "bottom right", edges: { bottom: true, right: true }, className: "-bottom-6 -right-6 cursor-nwse-resize" },
];

/** Invisible resize handles along the whole perimeter of a floating panel. */
export default function FloatingResizeHandles({ getHandleProps }: FloatingResizeHandlesProps) {
  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge.name}
          aria-hidden="true"
          data-floating-resize-handle={edge.name}
          className={`pointer-events-auto absolute z-20 touch-none ${edge.className}`}
          {...getHandleProps(edge.edges)}
        />
      ))}
      {/* After the edges, so where a corner and a strip overlap the corner wins. */}
      {CORNERS.map((corner) => (
        <div
          key={corner.name}
          aria-hidden="true"
          data-floating-resize-handle={corner.name}
          className={`pointer-events-auto absolute z-20 h-9 w-9 touch-none ${corner.className}`}
          {...getHandleProps(corner.edges)}
        />
      ))}
    </>
  );
}
