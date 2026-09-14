"use client";

import { useCardImageUrl } from "@/hooks/useCardImageUrl";
import type { CardImage, CardImageDraft } from "@/lib/study/card-images";

type CardFaceImageProps = {
  /** A stored image, or a form's draft of one. */
  source: CardImage | CardImageDraft;
  /** Empty when the image sits inside something already named. */
  alt: string;
  className?: string;
};

/** One card image, from Storage or from a file not yet uploaded. */
export default function CardFaceImage({ source, alt, className = "" }: CardFaceImageProps) {
  const isDraft = "kind" in source;
  const previewUrl = isDraft && source.kind === "new" ? source.previewUrl : undefined;
  const stored = isDraft ? (source.kind === "saved" ? source.image : undefined) : source;
  const resolved = useCardImageUrl(previewUrl ? undefined : stored);
  const src = previewUrl ?? resolved.url;

  if (!src) {
    return (
      <div
        {...(alt ? { role: "img", "aria-label": resolved.failed ? `${alt} (could not load)` : alt } : { "aria-hidden": true })}
        className={`grid min-h-[3rem] min-w-[3rem] place-items-center bg-[var(--color-glass-subtle)] text-center text-xs text-text-muted ${
          resolved.failed ? "" : "animate-pulse"
        } ${className}`}
      >
        {resolved.failed ? "Image unavailable" : null}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a private, per-user Storage URL that Next's image optimiser cannot fetch
    <img
      src={src}
      alt={alt}
      width={stored?.width || undefined}
      height={stored?.height || undefined}
      draggable={false}
      className={className}
    />
  );
}
