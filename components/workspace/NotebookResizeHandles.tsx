"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { NotebookResizeHandle } from "@/lib/workspace/notebooks";

type HandleEvents = {
  onStart: (handle: NotebookResizeHandle, event: ReactPointerEvent<HTMLElement>) => void;
  onMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onEnd: (event: ReactPointerEvent<HTMLElement>) => void;
};

const CORNERS: Array<{
  handle: NotebookResizeHandle;
  label: string;
  className: string;
}> = [
  { handle: "top-left", label: "Resize from the top left corner", className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize" },
  { handle: "top-right", label: "Resize from the top right corner", className: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize" },
  { handle: "bottom-right", label: "Resize from the bottom right corner", className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize" },
  { handle: "bottom-left", label: "Resize from the bottom left corner", className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize" },
];

/*
 * Each side is one strip along its whole length, between the corners, half
 * outside the box and half in. Only the corners could be pulled before, which
 * on a tablet meant hunting for a dot -- and a corner is the wrong place to
 * change one dimension of a graph.
 */
const SIDES: Array<{
  handle: NotebookResizeHandle;
  className: string;
  gripClass: string;
}> = [
  { handle: "top", className: "inset-x-5 top-0 h-7 -translate-y-1/2 cursor-ns-resize", gripClass: "h-1 w-6" },
  { handle: "bottom", className: "inset-x-5 bottom-0 h-7 translate-y-1/2 cursor-ns-resize", gripClass: "h-1 w-6" },
  { handle: "left", className: "inset-y-5 left-0 w-7 -translate-x-1/2 cursor-ew-resize", gripClass: "h-6 w-1" },
  { handle: "right", className: "inset-y-5 right-0 w-7 translate-x-1/2 cursor-ew-resize", gripClass: "h-6 w-1" },
];

/**
 * Resize handles for a selected image or graph on a notebook page: a dot at
 * each corner and the whole of each side.
 *
 * The corners stay buttons so a keyboard can reach them; the sides are for a
 * pointer only, and sit under the corners so a corner still wins where they meet.
 */
export default function NotebookResizeHandles({
  name,
  onStart,
  onMove,
  onEnd,
}: HandleEvents & { name: string }) {
  const events = (handle: NotebookResizeHandle) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onStart(handle, event),
    onPointerMove: onMove,
    onPointerUp: onEnd,
    onPointerCancel: onEnd,
  });

  return (
    <>
      {SIDES.map((side) => (
        <div
          key={side.handle}
          aria-hidden="true"
          data-resize-side={side.handle}
          className={`group pointer-events-auto absolute z-10 grid touch-none place-items-center ${side.className}`}
          {...events(side.handle)}
        >
          <span
            className={`rounded-full border border-white bg-accent shadow-e1 transition group-hover:scale-125 ${side.gripClass}`}
          />
        </div>
      ))}
      {CORNERS.map((corner) => (
        <button
          key={corner.handle}
          type="button"
          data-image-resize-handle={corner.handle}
          aria-label={`${corner.label} of ${name}`}
          title={corner.label}
          className={`group pointer-events-auto absolute z-10 inline-grid h-8 w-8 touch-none place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/55 ${corner.className}`}
          {...events(corner.handle)}
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 rounded-full border-2 border-white bg-accent shadow-e1 transition group-hover:scale-110"
          />
        </button>
      ))}
    </>
  );
}
