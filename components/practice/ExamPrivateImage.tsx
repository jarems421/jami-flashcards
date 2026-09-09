"use client";

import { useEffect, useState } from "react";
import { auth } from "@/services/firebase/client";

/**
 * An image that only an authenticated server route will hand over.
 *
 * Question figures are licensed material and frozen working is a student's own
 * evidence, so neither is a public URL: both are streamed through a route that
 * re-checks the session, and arrive here as a blob rather than an `src` anyone
 * could pass around.
 *
 * Give it a `key` of the same path when the path can change — remounting is
 * the reset, so the effect only ever reports the fetch it started itself.
 */
export default function ExamPrivateImage({
  path,
  alt,
  className = "",
}: {
  path: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void auth.currentUser
      ?.getIdToken()
      .then((token) => fetch(path, { headers: { Authorization: `Bearer ${token}` } }))
      .then((response) => {
        if (!response?.ok) throw new Error("image_unavailable");
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (failed) {
    return (
      <p className={`rounded-2xl bg-[var(--color-glass-subtle)] p-3 text-sm text-text-muted ${className}`}>
        This image could not be loaded.
      </p>
    );
  }
  if (!url) {
    return <div className={`aspect-[4/3] animate-pulse rounded-2xl bg-[var(--color-glass-subtle)] ${className}`} />;
  }
  // A blob URL from the session-authorised route, so next/image cannot help.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={`h-auto w-full rounded-2xl object-contain ${className}`} />;
}
