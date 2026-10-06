"use client";

import { useRef, type PointerEvent } from "react";
import type { OcclusionPoint, OcclusionShape } from "@/lib/study/image-occlusion";
import {
  moveShape,
  resizeShape,
  shapeFromPoints,
  type OcclusionCrop,
  type ResizeHandle,
} from "@/lib/study/image-occlusion-geometry";

type DiagramCropStageProps = {
  imageUrl: string | null;
  width: number;
  height: number;
  crop: OcclusionCrop;
  onChange: (crop: OcclusionCrop) => void;
};

type Gesture =
  | { kind: "move"; pointerId: number; origin: OcclusionShape; start: OcclusionPoint }
  | { kind: "resize"; pointerId: number; origin: OcclusionShape; handle: ResizeHandle }
  | { kind: "draw"; pointerId: number; start: OcclusionPoint };

const HANDLES: ResizeHandle[] = ["nw", "ne", "sw", "se"];
/** A crop narrower than this is a slip, not a diagram. */
const MIN_CROP = 0.05;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function isWholePicture(crop: OcclusionCrop) {
  return crop.x <= 0.001 && crop.y <= 0.001 && crop.width >= 0.998 && crop.height >= 0.998;
}

function asShape(crop: OcclusionCrop): OcclusionShape {
  return { kind: "rect", ...crop };
}

function asCrop(shape: OcclusionShape): OcclusionCrop | null {
  if (shape.width < MIN_CROP || shape.height < MIN_CROP) return null;
  return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
}

/**
 * Choosing the part of a picture that is the diagram.
 *
 * A slide or a textbook photo is mostly not the diagram. Drag across the
 * diagram to frame it, then move the frame or drag its corners to adjust.
 */
export default function DiagramCropStage({ imageUrl, width, height, crop, onChange }: DiagramCropStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const aspect = width / height;
  const frameStyle = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.width * 100}%`,
    height: `${crop.height * 100}%`,
  };

  const toPoint = (event: { clientX: number; clientY: number }): OcclusionPoint => {
    const rect = stageRef.current!.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  const begin = (event: PointerEvent<HTMLElement>, gesture: Gesture) => {
    if (event.button !== 0 || gestureRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = gesture;
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const point = toPoint(event);
    const next =
      gesture.kind === "move"
        ? moveShape(gesture.origin, point.x - gesture.start.x, point.y - gesture.start.y)
        : gesture.kind === "resize"
          ? resizeShape(gesture.origin, gesture.handle, point)
          : shapeFromPoints("rect", gesture.start, point);
    const nextCrop = asCrop(next);
    if (nextCrop) onChange(nextCrop);
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId === event.pointerId) gestureRef.current = null;
  };

  return (
    <div className="h-full w-full overflow-hidden [container-type:size]">
      <div className="grid h-full w-full place-items-center p-4">
        <div
          ref={stageRef}
          onPointerDown={(event) => begin(event, { kind: "draw", pointerId: event.pointerId, start: toPoint(event) })}
          onPointerMove={onPointerMove}
          onPointerUp={end}
          onPointerCancel={end}
          className="relative cursor-crosshair touch-none select-none rounded-lg bg-white shadow-card"
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `min(100cqw - 2rem, (100cqh - 2rem) * ${aspect})`,
          }}
        >
          {/* The picture and its dimming are clipped to the picture; the handles are not, so a corner at the edge stays grabbable. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview of a file not yet uploaded
              <img src={imageUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
            ) : (
              <div className="absolute inset-0 animate-pulse bg-[var(--color-glass-subtle)]" />
            )}
            <div
              className="absolute border-2 border-white"
              style={{
                ...frameStyle,
                // Everything outside the frame is dimmed, so what will be kept is obvious.
                boxShadow: "0 0 0 9999px rgba(8, 6, 20, 0.58)",
              }}
            >
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }, (_, index) => (
                  <span key={index} className="border border-white/25" />
                ))}
              </div>
            </div>
          </div>
          <div
            role="presentation"
            onPointerDown={(event) =>
              // A frame around the whole picture has nowhere to move, so a drag inside it starts a new one.
              begin(
                event,
                isWholePicture(crop)
                  ? { kind: "draw", pointerId: event.pointerId, start: toPoint(event) }
                  : { kind: "move", pointerId: event.pointerId, origin: asShape(crop), start: toPoint(event) }
              )
            }
            className={`absolute touch-none ${isWholePicture(crop) ? "cursor-crosshair" : "cursor-move"}`}
            style={frameStyle}
          >
            {HANDLES.map((handle) => (
              <div
                key={handle}
                aria-hidden="true"
                onPointerDown={(event) =>
                  begin(event, { kind: "resize", pointerId: event.pointerId, origin: asShape(crop), handle })
                }
                className={`absolute z-10 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center ${
                  handle === "nw" || handle === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize"
                }`}
                style={{
                  left: handle === "nw" || handle === "sw" ? "0%" : "100%",
                  top: handle === "nw" || handle === "ne" ? "0%" : "100%",
                }}
              >
                <span className="occlusion-handle h-4 w-4 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
