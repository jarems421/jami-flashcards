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
  /** A resize is under way: every handle and the outline light up. */
  active: boolean;
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
 * A tablet has no hover cursor to say resizing exists at all, so there the
 * side grips show all the time, like the corner arcs. With a mouse they appear
 * on hover and while resizing, so a resting panel is not ringed with marks.
 * Grips and arcs all run on the same line, 1-4px outside the panel.
 */
const EDGES: Array<{
  name: string;
  edges: FloatingResizeEdges;
  className: string;
  barClassName: string;
}> = [
  {
    name: "top",
    edges: { top: true },
    className: "inset-x-0 -top-6 h-7 cursor-ns-resize",
    barClassName: "left-1/2 top-5 h-[3px] w-10 -translate-x-1/2",
  },
  {
    name: "bottom",
    edges: { bottom: true },
    className: "inset-x-0 -bottom-6 h-8 cursor-ns-resize",
    barClassName: "bottom-5 left-1/2 h-[3px] w-10 -translate-x-1/2",
  },
  {
    name: "left",
    edges: { left: true },
    className: "inset-y-0 -left-6 w-8 cursor-ew-resize",
    barClassName: "left-5 top-1/2 h-10 w-[3px] -translate-y-1/2",
  },
  {
    name: "right",
    edges: { right: true },
    className: "inset-y-0 -right-6 w-8 cursor-ew-resize",
    barClassName: "right-5 top-1/2 h-10 w-[3px] -translate-y-1/2",
  },
];

// Each arc runs parallel to the panel's rounded corner, on the grips' line.
const CORNERS: Array<{
  name: string;
  edges: FloatingResizeEdges;
  className: string;
  arcClassName: string;
}> = [
  {
    name: "top left",
    edges: { top: true, left: true },
    className: "-left-6 -top-6 cursor-nwse-resize",
    arcClassName: "left-5 top-5 rounded-tl-2xl border-l-[3px] border-t-[3px]",
  },
  {
    name: "top right",
    edges: { top: true, right: true },
    className: "-right-6 -top-6 cursor-nesw-resize",
    arcClassName: "right-5 top-5 rounded-tr-2xl border-r-[3px] border-t-[3px]",
  },
  {
    name: "bottom left",
    edges: { bottom: true, left: true },
    className: "-bottom-6 -left-6 cursor-nesw-resize",
    arcClassName: "bottom-5 left-5 rounded-bl-2xl border-b-[3px] border-l-[3px]",
  },
  {
    name: "bottom right",
    edges: { bottom: true, right: true },
    className: "-bottom-6 -right-6 cursor-nwse-resize",
    arcClassName: "bottom-5 right-5 rounded-br-2xl border-b-[3px] border-r-[3px]",
  },
];

/** Resize handles along the whole perimeter of a floating panel. */
export default function FloatingResizeHandles({
  getHandleProps,
  active,
}: FloatingResizeHandlesProps) {
  const lit = active ? "bg-accent opacity-100" : "";
  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge.name}
          aria-hidden="true"
          data-floating-resize-handle={edge.name}
          className={`group pointer-events-auto absolute z-20 touch-none ${edge.className}`}
          {...getHandleProps(edge.edges)}
        >
          <span
            className={`pointer-events-none absolute rounded-full bg-[var(--color-border-strong)] opacity-0 transition duration-fast group-hover:bg-accent group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${edge.barClassName} ${lit}`}
          />
        </div>
      ))}
      {/* After the edges, so where a corner and a strip overlap the corner wins. */}
      {CORNERS.map((corner) => (
        <div
          key={corner.name}
          aria-hidden="true"
          data-floating-resize-handle={corner.name}
          className={`group pointer-events-auto absolute z-20 h-9 w-9 touch-none ${corner.className}`}
          {...getHandleProps(corner.edges)}
        >
          <span
            className={`pointer-events-none absolute h-7 w-7 border-[var(--color-border-strong)] transition duration-fast group-hover:border-accent ${corner.arcClassName} ${
              active ? "border-accent" : ""
            }`}
          />
        </div>
      ))}
    </>
  );
}
