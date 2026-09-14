"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Button } from "@/components/ui";
import { derivePhotoBackgroundPaletteForView } from "@/lib/app/photo-background-palette";
import {
  DEFAULT_PHOTO_BACKGROUND_VIEW,
  MAX_PHOTO_BACKGROUND_ZOOM,
  normalizePhotoBackgroundView,
  photoBackgroundImageValue,
  photoBackgroundPosition,
  type CachedPhotoBackground,
  type PhotoBackgroundView,
} from "@/lib/app/photo-background";

type PhotoBackgroundPositionerProps = {
  background: CachedPhotoBackground;
  saving: boolean;
  onSave: (view: PhotoBackgroundView) => void;
};

function sameView(left: PhotoBackgroundView, right: PhotoBackgroundView) {
  return left.focusX === right.focusX && left.focusY === right.focusY && left.zoom === right.zoom;
}

/** How far a drag or an arrow key moves the photo. */
const KEY_STEP = 2;
const KEY_STEP_LARGE = 10;

/**
 * Moving and zooming the photo, previewed in the shape of this screen.
 *
 * The preview is drawn exactly the way the background is -- the same cover,
 * position and zoom -- and its sample panel is recoloured as the photo moves,
 * so what is shown is what saving will give.
 */
export default function PhotoBackgroundPositioner({
  background,
  saving,
  onSave,
}: PhotoBackgroundPositionerProps) {
  const saved = normalizePhotoBackgroundView(background);
  const [view, setView] = useState<PhotoBackgroundView>(saved);
  const [screenAspect, setScreenAspect] = useState(16 / 10);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    view: PhotoBackgroundView;
  } | null>(null);
  const zoomId = useId();
  const hintId = useId();

  useEffect(() => {
    const measure = () => setScreenAspect(window.innerWidth / Math.max(1, window.innerHeight));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const palette = useMemo(
    () =>
      background.sample
        ? derivePhotoBackgroundPaletteForView(background.sample, view)
        : { scheme: background.scheme, vars: background.vars },
    [background, view]
  );
  const vars = palette.vars;
  const position = photoBackgroundPosition(view);
  const imageAspect = background.sample ? background.sample.width / background.sample.height : null;

  /*
   * Moves the focus so the photo follows the finger one to one.
   *
   * Shifting the focus from one edge to the other slides the photo by however
   * much of it overhangs the frame, which depends on the photo's shape against
   * the frame's and on the zoom. Dividing by that overhang is what makes a drag
   * feel like holding the photo rather than steering it.
   */
  const panBy = (start: PhotoBackgroundView, dx: number, dy: number, rect: DOMRect) => {
    const frameAspect = rect.width / Math.max(1, rect.height);
    const visibleX = imageAspect ? Math.min(1, frameAspect / imageAspect) : 1;
    const visibleY = imageAspect ? Math.min(1, imageAspect / frameAspect) : 1;
    const pan = (delta: number, size: number, visible: number) => {
      const overhang = (size * (start.zoom - visible)) / visible;
      return overhang > 0.5 ? (delta / overhang) * 100 : 0;
    };
    return normalizePhotoBackgroundView({
      zoom: start.zoom,
      focusX: start.focusX - pan(dx, rect.width, visibleX),
      focusY: start.focusY - pan(dy, rect.height, visibleY),
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (saving) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !frame) return;
    setView(panBy(drag.view, event.clientX - drag.x, event.clientY - drag.y, frame.getBoundingClientRect()));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (saving) return;
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const moves: Record<string, Partial<PhotoBackgroundView>> = {
      ArrowLeft: { focusX: view.focusX - step },
      ArrowRight: { focusX: view.focusX + step },
      ArrowUp: { focusY: view.focusY - step },
      ArrowDown: { focusY: view.focusY + step },
      "+": { zoom: view.zoom + 0.1 },
      "=": { zoom: view.zoom + 0.1 },
      "-": { zoom: view.zoom - 0.1 },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setView(normalizePhotoBackgroundView({ ...view, ...move }));
  };

  return (
    <div className="space-y-4">
      <div
        ref={frameRef}
        // A slider that moves in two directions: the arrow keys move it, and
        // the value read out says where across and down the photo is held.
        role="slider"
        tabIndex={0}
        aria-label="Photo position"
        aria-describedby={hintId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={view.focusX}
        aria-valuetext={`${Math.round(view.focusX)}% across, ${Math.round(view.focusY)}% down, zoom ${view.zoom.toFixed(1)}×`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className={`relative mx-auto touch-none select-none overflow-hidden rounded-2xl border border-[var(--color-border)] outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
          saving ? "cursor-progress" : "cursor-grab active:cursor-grabbing"
        }`}
        style={{
          aspectRatio: `${screenAspect.toFixed(4)}`,
          // As wide as the card allows, but never taller than 26rem.
          width: `min(100%, calc(26rem * ${screenAspect.toFixed(4)}))`,
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundColor: vars["--photo-base"],
            backgroundImage: photoBackgroundImageValue(background.imageUrl),
            backgroundRepeat: "no-repeat",
            backgroundSize: "cover",
            backgroundPosition: position,
            transform: `scale(${view.zoom})`,
            transformOrigin: position,
          }}
        />
        <div aria-hidden="true" className="absolute inset-0" style={{ background: vars["--photo-overlay"] }} />
        {/* The palette as it will look over this part of the photo, drawn in its own colours. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 left-3 right-3 max-w-xs rounded-xl p-3 sm:bottom-4 sm:left-4"
          style={{
            background: `rgb(${vars["--photo-surface-rgb"]} / ${vars["--photo-panel-alpha"]})`,
            border: `1px solid rgb(${vars["--photo-line-rgb"]} / 0.18)`,
          }}
        >
          <p className="text-sm font-semibold" style={{ color: vars["--photo-text"] }}>
            Your panels will look like this
          </p>
          <p className="mt-0.5 text-xs" style={{ color: vars["--photo-text-muted"] }}>
            Colours picked from this part of your photo
          </p>
          <span
            className="mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: vars["--photo-accent"], color: vars["--photo-on-accent"] }}
          >
            Accent
          </span>
        </div>
      </div>

      <p id={hintId} className="text-center text-xs leading-5 text-text-muted">
        Drag the photo, or use the arrow keys, to choose what stays in view. The preview is the
        shape of this screen; others show a little more or less around the same spot.
      </p>

      <div className="flex items-center gap-3">
        <label htmlFor={zoomId} className="text-xs font-semibold text-text-secondary">
          Zoom
        </label>
        <input
          id={zoomId}
          type="range"
          min={100}
          max={MAX_PHOTO_BACKGROUND_ZOOM * 100}
          step={5}
          value={Math.round(view.zoom * 100)}
          disabled={saving}
          onChange={(event) =>
            setView(normalizePhotoBackgroundView({ ...view, zoom: Number(event.target.value) / 100 }))
          }
          className="h-8 min-w-0 flex-1 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
        />
        <span className="w-10 text-right text-xs font-semibold tabular-nums text-text-muted">
          {view.zoom.toFixed(1)}×
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={saving || sameView(view, saved)} onClick={() => onSave(view)}>
          {saving ? "Saving…" : "Save position"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={saving || sameView(view, DEFAULT_PHOTO_BACKGROUND_VIEW)}
          onClick={() => setView(DEFAULT_PHOTO_BACKGROUND_VIEW)}
        >
          Centre
        </Button>
      </div>
    </div>
  );
}
