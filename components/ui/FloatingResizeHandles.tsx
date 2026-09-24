"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { FloatingResizeEdges } from "@/lib/ui/floating-panel";

type ResizeHandleProps = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
};

type FloatingResizeHandlesProps = {
  getHandleProps: (edges: FloatingResizeEdges) => ResizeHandleProps;
  label: string;
};

/*
 * Edges are wide invisible strips straddling the border, so a finger or a
 * Pencil finds them without aiming; corners carry a visible grip, because on a
 * tablet there is no hover cursor to say the panel can be resized at all.
 */
const EDGES: Array<{ name: string; edges: FloatingResizeEdges; className: string }> = [
  { name: "top", edges: { top: true }, className: "inset-x-5 -top-1.5 h-3 cursor-ns-resize" },
  { name: "bottom", edges: { bottom: true }, className: "inset-x-5 -bottom-1.5 h-3 cursor-ns-resize" },
  { name: "left", edges: { left: true }, className: "inset-y-5 -left-1.5 w-3 cursor-ew-resize" },
  { name: "right", edges: { right: true }, className: "inset-y-5 -right-1.5 w-3 cursor-ew-resize" },
];

const CORNERS: Array<{
  name: string;
  edges: FloatingResizeEdges;
  className: string;
  gripClassName: string;
}> = [
  {
    name: "top left",
    edges: { top: true, left: true },
    className: "-left-1.5 -top-1.5 cursor-nwse-resize",
    gripClassName: "left-2 top-2 border-l-2 border-t-2 rounded-tl-lg",
  },
  {
    name: "top right",
    edges: { top: true, right: true },
    className: "-right-1.5 -top-1.5 cursor-nesw-resize",
    gripClassName: "right-2 top-2 border-r-2 border-t-2 rounded-tr-lg",
  },
  {
    name: "bottom left",
    edges: { bottom: true, left: true },
    className: "-bottom-1.5 -left-1.5 cursor-nesw-resize",
    gripClassName: "bottom-2 left-2 border-b-2 border-l-2 rounded-bl-lg",
  },
  {
    name: "bottom right",
    edges: { bottom: true, right: true },
    className: "-bottom-1.5 -right-1.5 cursor-nwse-resize",
    gripClassName: "bottom-2 right-2 border-b-2 border-r-2 rounded-br-lg",
  },
];

/** Handles on every edge and corner of a floating panel, for resizing it. */
export default function FloatingResizeHandles({
  getHandleProps,
  label,
}: FloatingResizeHandlesProps) {
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
      {CORNERS.map((corner) => (
        <div
          key={corner.name}
          aria-hidden="true"
          title={`Resize ${label}`}
          data-floating-resize-handle={corner.name}
          className={`group pointer-events-auto absolute z-20 h-7 w-7 touch-none ${corner.className}`}
          {...getHandleProps(corner.edges)}
        >
          <span
            className={`pointer-events-none absolute h-2.5 w-2.5 border-[var(--color-border-strong)] transition duration-fast group-hover:border-accent group-active:border-accent ${corner.gripClassName}`}
          />
        </div>
      ))}
    </>
  );
}
