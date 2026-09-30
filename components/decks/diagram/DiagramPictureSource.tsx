"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import LibraryPdfPagePicker from "@/components/decks/diagram/LibraryPdfPagePicker";
import { Button } from "@/components/ui";
import { prepareDiagramPicture, type DiagramPicture } from "@/lib/study/diagram-image";

type DiagramPictureSourceProps = {
  userId: string;
  disabled?: boolean;
  /** `crop` when the picture is a whole page and the diagram is only part of it. */
  onPicture: (picture: DiagramPicture, next: "label" | "crop") => void;
};

function isTextField(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Every way into a diagram: a file, a photo, a paste, a drop, or a Library PDF.
 *
 * A pasted screenshot is how most diagrams arrive on a laptop, so paste works
 * anywhere on the page while this is showing -- except inside a text field,
 * where a paste means text.
 */
export default function DiagramPictureSource({ userId, disabled = false, onPicture }: DiagramPictureSourceProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const busy = disabled || preparing;

  const take = async (blob: Blob | undefined | null, name?: string) => {
    if (!blob || busy) return;
    setPreparing(true);
    setError(null);
    try {
      onPicture(await prepareDiagramPicture(blob, name ?? (blob instanceof File ? blob.name : "diagram")), "label");
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : "That picture could not be opened.");
    } finally {
      setPreparing(false);
    }
  };
  const takeRef = useRef(take);
  useEffect(() => {
    takeRef.current = take;
  });

  useEffect(() => {
    if (disabled) return;
    const onPaste = (event: ClipboardEvent) => {
      if (isTextField(event.target)) return;
      const file = Array.from(event.clipboardData?.files ?? []).find((entry) => entry.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      void takeRef.current(file, "pasted-diagram");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [disabled]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = Array.from(event.dataTransfer.files).find((entry) => entry.type.startsWith("image/"));
    if (file) void take(file);
    else setError("Drop a picture: a JPEG, PNG or WebP image.");
  };

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          void take(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          void take(event.target.files?.[0], "photo");
          event.target.value = "";
        }}
      />
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={(event) => {
          // Moving between the zone's own children is not leaving it.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        aria-describedby={error ? errorId : undefined}
        className={`flex flex-col items-center gap-4 rounded-2xl border border-dashed px-5 py-7 text-center transition duration-fast sm:py-9 ${
          dragging
            ? "border-accent bg-[var(--color-glass-medium)]"
            : "border-[var(--color-border-strong)] bg-[var(--color-glass-subtle)]"
        }`}
      >
        <svg
          viewBox="0 0 48 40"
          fill="none"
          aria-hidden="true"
          className="h-12 w-14 text-accent"
        >
          <rect x="3" y="3" width="42" height="34" rx="6" stroke="currentColor" strokeWidth="2" opacity="0.6" />
          <path d="m8 31 10-11 7 7 5-5 10 9" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" opacity="0.6" />
          <rect x="24" y="8" width="16" height="7" rx="2" fill="currentColor" />
          <rect x="8" y="9" width="11" height="6" rx="2" fill="currentColor" opacity="0.45" />
        </svg>
        <div className="space-y-1">
          <p className="text-base font-semibold text-text-primary">
            {preparing ? "Preparing your picture…" : "Add a diagram"}
          </p>
          <p className="text-sm text-text-secondary">
            Drop a picture here, paste a screenshot, or choose one.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
            Choose a picture
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
            className="hidden [@media(pointer:coarse)]:inline-flex"
          >
            Take a photo
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setPdfOpen(true)}>
            From a Library PDF
          </Button>
        </div>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-sm font-medium text-danger-text">
          {error}
        </p>
      ) : null}
      <LibraryPdfPagePicker
        open={pdfOpen}
        userId={userId}
        onClose={() => setPdfOpen(false)}
        onPicture={(picture) => {
          setPdfOpen(false);
          onPicture(picture, "crop");
        }}
      />
    </div>
  );
}
