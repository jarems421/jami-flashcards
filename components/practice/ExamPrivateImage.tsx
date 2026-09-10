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
  imageClassName = "",
}: {
  path: string;
  alt: string;
  className?: string;
  /** Applied to the image itself, for a viewer that scales it. */
  imageClassName?: string;
}) {
  const [url, setUrl] = useState("");
  const [attempt, setAttempt] = useState(0);
  /*
   * Which attempt failed, rather than a flag cleared on the way in. Resetting
   * a boolean inside the effect is a synchronous setState that cascades a
   * render; comparing against the current attempt says the same thing without
   * one.
   */
  const [failedAttempt, setFailedAttempt] = useState(-1);
  const failed = failedAttempt === attempt;

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
      .catch(() => active && setFailedAttempt(attempt));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attempt, path]);

  if (failed) {
    /*
     * A figure that will not load can make a question unanswerable, and the
     * usual cause is a dropped request rather than a missing file -- so this
     * offers the one thing that fixes that, instead of a dead end.
     */
    return (
      <div className={`rounded-2xl bg-[var(--color-glass-subtle)] p-3 ${className}`}>
        <p className="text-sm text-text-muted">This image could not be loaded.</p>
        <button
          type="button"
          className="mt-2 text-sm font-medium text-accent underline-offset-2 hover:underline"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!url) {
    return <div className={`aspect-[4/3] animate-pulse rounded-2xl bg-[var(--color-glass-subtle)] ${className}`} />;
  }
  return (
    // A blob URL from the session-authorised route, so next/image cannot help.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className={`h-auto w-full rounded-2xl object-contain ${className} ${imageClassName}`}
    />
  );
}
