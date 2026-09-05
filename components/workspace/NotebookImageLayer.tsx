"use client";

import Image from "next/image";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  moveNotebookImageRef,
  NOTEBOOK_PAGE_COORDINATE_HEIGHT,
  NOTEBOOK_PAGE_COORDINATE_WIDTH,
  resizeNotebookImageRef,
  type NotebookImageRef,
  type NotebookImageResizeCorner,
} from "@/lib/workspace/notebooks";
import { getNotebookFileBytes } from "@/services/study/notebook-files";

/*
 * Every corner drags, the way an image behaves in any other editor. The grip is
 * a small dot inside a much larger invisible hit box, so a fingertip or a Pencil
 * can find it on an iPad without the dot itself covering the artwork.
 */
const RESIZE_CORNERS: Array<{
  corner: NotebookImageResizeCorner;
  label: string;
  positionClass: string;
  cursorClass: string;
}> = [
  {
    corner: "top-left",
    label: "Resize from the top left corner",
    positionClass: "left-0 top-0 -translate-x-1/2 -translate-y-1/2",
    cursorClass: "cursor-nwse-resize",
  },
  {
    corner: "top-right",
    label: "Resize from the top right corner",
    positionClass: "right-0 top-0 translate-x-1/2 -translate-y-1/2",
    cursorClass: "cursor-nesw-resize",
  },
  {
    corner: "bottom-right",
    label: "Resize from the bottom right corner",
    positionClass: "bottom-0 right-0 translate-x-1/2 translate-y-1/2",
    cursorClass: "cursor-nwse-resize",
  },
  {
    corner: "bottom-left",
    label: "Resize from the bottom left corner",
    positionClass: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2",
    cursorClass: "cursor-nesw-resize",
  },
];

function placement(image: NotebookImageRef) {
  return {
    x: image.x ?? 0,
    y: image.y ?? 0,
    width: image.displayWidth ?? 480,
    height: image.displayHeight ?? 360,
  };
}

function styleFor(image: NotebookImageRef) {
  const placed = placement(image);
  return {
    left: `${(placed.x / NOTEBOOK_PAGE_COORDINATE_WIDTH) * 100}%`,
    top: `${(placed.y / NOTEBOOK_PAGE_COORDINATE_HEIGHT) * 100}%`,
    width: `${(placed.width / NOTEBOOK_PAGE_COORDINATE_WIDTH) * 100}%`,
    height: `${(placed.height / NOTEBOOK_PAGE_COORDINATE_HEIGHT) * 100}%`,
  };
}

function NotebookPlacedImage({ image }: { image: NotebookImageRef }) {
  const [loadedUrl, setLoadedUrl] = useState("");
  const assetUrl = image.localPreviewUrl ?? loadedUrl;

  useEffect(() => {
    if (image.localPreviewUrl || !image.storagePath) return;
    let objectUrl = "";
    let cancelled = false;
    void getNotebookFileBytes(image.storagePath)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes]));
        setLoadedUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.localPreviewUrl, image.storagePath]);

  return (
    <div
      className="pointer-events-none absolute z-10 overflow-hidden rounded-sm"
      style={styleFor(image)}
    >
      {assetUrl ? (
        <Image
          alt={image.altText || "Notebook illustration"}
          src={assetUrl}
          fill
          unoptimized
          sizes="48rem"
          className="object-contain"
        />
      ) : (
        <div
          aria-hidden="true"
          className="h-full w-full animate-pulse rounded-sm bg-[var(--color-glass-subtle)]"
        />
      )}
    </div>
  );
}

type Gesture = {
  imageId: string;
  kind: "move" | "resize";
  corner?: NotebookImageResizeCorner;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  original: NotebookImageRef;
};

type Props = {
  images: NotebookImageRef[];
  editingEnabled?: boolean;
  selectedImageId?: string | null;
  onSelect?: (imageId: string | null) => void;
  onCommit?: (images: NotebookImageRef[]) => void | Promise<void>;
};

function NotebookImageLayer({
  images,
  editingEnabled = false,
  selectedImageId = null,
  onSelect,
  onCommit,
}: Props) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [draft, setDraft] = useState<NotebookImageRef | null>(null);
  /*
   * Where the image was left, held until the save round-trip lands.
   *
   * A commit flushes the page and then writes to Firestore, so the `images`
   * prop keeps the pre-drag geometry for a few hundred milliseconds after the
   * pointer lifts. Dropping the drag preview at pointer-up made the image snap
   * back to its old size and place for that window, then jump forwards again
   * once the write returned.
   */
  const [pending, setPending] = useState<NotebookImageRef | null>(null);
  const commitIdRef = useRef(0);
  const displayedImages = images.map((image) => {
    if (draft?.id === image.id) return draft;
    return pending?.id === image.id ? pending : image;
  });

  const commitImage = useCallback(
    (next: NotebookImageRef) => {
      setPending(next);
      const commitId = (commitIdRef.current += 1);
      void Promise.resolve(
        onCommit?.(
          images.map((image) => {
            if (image.id === next.id) return next;
            return pending?.id === image.id ? pending : image;
          })
        )
      )
        .catch(() => undefined)
        .finally(() => {
          // A newer gesture owns the preview by now; leave its value alone. A
          // rejected save clears too, so the image falls back to what is stored.
          if (commitIdRef.current === commitId) setPending(null);
        });
    },
    [images, onCommit, pending]
  );

  const updateGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return null;
      const bounds = layerRef.current?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return null;
      const deltaX =
        ((event.clientX - gesture.startClientX) / bounds.width) *
        NOTEBOOK_PAGE_COORDINATE_WIDTH;
      const deltaY =
        ((event.clientY - gesture.startClientY) / bounds.height) *
        NOTEBOOK_PAGE_COORDINATE_HEIGHT;
      const next =
        gesture.kind === "move"
          ? moveNotebookImageRef(gesture.original, deltaX, deltaY)
          : resizeNotebookImageRef(
              gesture.original,
              deltaX,
              deltaY,
              gesture.corner
            );
      setDraft(next);
      return next;
    },
    [gesture]
  );

  const startGesture = useCallback(
    (
      image: NotebookImageRef,
      event: ReactPointerEvent<HTMLElement>,
      corner?: NotebookImageResizeCorner
    ) => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setGesture({
        imageId: image.id,
        kind: corner ? "resize" : "move",
        ...(corner ? { corner } : {}),
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        // The displayed image, so a drag that starts mid-save continues from
        // what the student can see rather than from the last stored geometry.
        original: image,
      });
    },
    []
  );

  const finishGesture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      const next = updateGesture(event) ?? draft ?? gesture.original;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setGesture(null);
      setDraft(null);
      commitImage(next);
    },
    [commitImage, draft, gesture, updateGesture]
  );

  const nudge = useCallback(
    (image: NotebookImageRef, event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const amount = event.shiftKey ? 24 : 8;
      const delta =
        event.key === "ArrowLeft"
          ? { x: -amount, y: 0 }
          : event.key === "ArrowRight"
            ? { x: amount, y: 0 }
            : event.key === "ArrowUp"
              ? { x: 0, y: -amount }
              : event.key === "ArrowDown"
                ? { x: 0, y: amount }
                : null;
      if (!delta) return;
      event.preventDefault();
      commitImage(moveNotebookImageRef(image, delta.x, delta.y));
    },
    [commitImage]
  );

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0">
      {displayedImages.map((image) => (
        <NotebookPlacedImage key={image.id} image={image} />
      ))}
      {editingEnabled ? (
        <div className="pointer-events-none absolute inset-0 z-[26]">
          {displayedImages.map((image) => {
            const selected = selectedImageId === image.id;
            return (
              <div
                key={image.id}
                className="pointer-events-none absolute"
                style={styleFor(image)}
              >
                <button
                  type="button"
                  aria-label={`Move ${image.altText || "notebook illustration"}`}
                  aria-pressed={selected}
                  className={`pointer-events-auto absolute inset-0 touch-none rounded-sm border bg-transparent outline-none transition focus-visible:ring-2 focus-visible:ring-accent/55 ${
                    selected
                      ? "cursor-move border-accent shadow-ring"
                      : "cursor-pointer border-transparent hover:border-accent/55"
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect?.(image.id);
                  }}
                  onKeyDown={(event) => nudge(image, event)}
                  onPointerDown={(event) => {
                    onSelect?.(image.id);
                    startGesture(image, event);
                  }}
                  onPointerMove={(event) => {
                    event.stopPropagation();
                    updateGesture(event);
                  }}
                  onPointerUp={finishGesture}
                  onPointerCancel={finishGesture}
                />
                {selected
                  ? RESIZE_CORNERS.map((handle) => (
                      <button
                        key={handle.corner}
                        type="button"
                        data-image-resize-handle={handle.corner}
                        aria-label={`${handle.label} of ${
                          image.altText || "notebook illustration"
                        }`}
                        title={handle.label}
                        className={`group pointer-events-auto absolute z-10 inline-grid h-8 w-8 touch-none place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/55 ${handle.positionClass} ${handle.cursorClass}`}
                        onPointerDown={(event) =>
                          startGesture(image, event, handle.corner)
                        }
                        onPointerMove={(event) => {
                          event.stopPropagation();
                          updateGesture(event);
                        }}
                        onPointerUp={finishGesture}
                        onPointerCancel={finishGesture}
                      >
                        <span
                          aria-hidden="true"
                          className="h-4 w-4 rounded-full border-2 border-white bg-accent shadow-e1 transition group-hover:scale-110"
                        />
                      </button>
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default memo(NotebookImageLayer);
