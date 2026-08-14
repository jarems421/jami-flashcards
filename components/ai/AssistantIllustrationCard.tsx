"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { AssistantIllustration } from "@/lib/ai/jami-assistant";
import { loadAssistantIllustrationBlob } from "@/services/ai/assistant-illustrations";

export default function AssistantIllustrationCard({
  illustration,
  canInsert,
  inserted,
  inserting,
  onInsert,
}: {
  illustration: AssistantIllustration;
  canInsert: boolean;
  inserted: boolean;
  inserting: boolean;
  onInsert: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    void loadAssistantIllustrationBlob(illustration, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [illustration]);

  const extension =
    illustration.mimeType === "image/jpeg"
      ? "jpg"
      : illustration.mimeType === "image/webp"
        ? "webp"
        : "png";

  return (
    <figure className="mt-3 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] shadow-e0">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--color-glass-subtle)]">
        {url ? (
          <Image
            src={url}
            alt={illustration.altText}
            fill
            unoptimized
            sizes="(min-width: 640px) 24rem, 84vw"
            className="object-contain"
          />
        ) : loadFailed ? (
          <div className="grid h-full place-items-center px-5 text-center text-xs leading-5 text-text-muted">
            This visual could not be loaded. It may have been removed.
          </div>
        ) : (
          <div className="grid h-full place-items-center" role="status" aria-label="Loading visual">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent/45 border-r-transparent" />
          </div>
        )}
      </div>
      <figcaption className="space-y-3 p-3.5">
        <p className="text-xs leading-5 text-text-secondary">{illustration.caption}</p>
        <div className="flex flex-wrap gap-2">
          {url ? (
            <a
              href={url}
              download={`jami-visual-${illustration.id}.${extension}`}
              className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-2xs font-semibold text-text-secondary transition hover:border-[var(--color-border-strong)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            >
              Download
            </a>
          ) : null}
          {canInsert ? (
            <button
              type="button"
              disabled={inserted || inserting || !url}
              className="rounded-full bg-accent px-3 py-1.5 text-2xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--color-glass-medium)] disabled:text-text-muted"
              onClick={onInsert}
            >
              {inserted ? "Added to page" : inserting ? "Adding..." : "Add to page"}
            </button>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}
