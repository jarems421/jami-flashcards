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
} from "@/lib/workspace/notebooks";
import { getNotebookFileBytes } from "@/services/study/notebook-files";

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
  const displayedImages = images.map((image) =>
    draft?.id === image.id ? draft : image
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
          : resizeNotebookImageRef(gesture.original, deltaX, deltaY);
      setDraft(next);
      return next;
    },
    [gesture]
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
      void onCommit?.(
        images.map((image) => (image.id === gesture.imageId ? next : image))
      );
    },
    [draft, gesture, images, onCommit, updateGesture]
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
      const next = moveNotebookImageRef(image, delta.x, delta.y);
      void onCommit?.(images.map((item) => (item.id === image.id ? next : item)));
    },
    [images, onCommit]
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
                    event.stopPropagation();
                    onSelect?.(image.id);
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setGesture({
                      imageId: image.id,
                      kind: "move",
                      pointerId: event.pointerId,
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      original: image,
                    });
                  }}
                  onPointerMove={(event) => {
                    event.stopPropagation();
                    updateGesture(event);
                  }}
                  onPointerUp={finishGesture}
                  onPointerCancel={finishGesture}
                />
                {selected ? (
                  <button
                    type="button"
                    aria-label="Resize notebook illustration"
                    className="pointer-events-auto absolute -bottom-2 -right-2 h-5 w-5 cursor-se-resize touch-none rounded-full border-2 border-white bg-accent shadow-e1"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setGesture({
                        imageId: image.id,
                        kind: "resize",
                        pointerId: event.pointerId,
                        startClientX: event.clientX,
                        startClientY: event.clientY,
                        original: image,
                      });
                    }}
                    onPointerMove={(event) => {
                      event.stopPropagation();
                      updateGesture(event);
                    }}
                    onPointerUp={finishGesture}
                    onPointerCancel={finishGesture}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default memo(NotebookImageLayer);
