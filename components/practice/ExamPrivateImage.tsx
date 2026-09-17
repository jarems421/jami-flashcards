"use client";

import { useEffect, useState, type ReactNode } from "react";
import { acquireCachedImageUrl } from "@/lib/practice/exam-private-image-cache";
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
  fallback,
  fill = false,
  width,
  height,
  cache = false,
  onReady,
}: {
  path: string;
  alt: string;
  className?: string;
  /** Applied to the image itself, for a viewer that scales it. */
  imageClassName?: string;
  /**
   * Shown instead of the retry prompt when the image cannot be had, for an image
   * with a readable alternative -- a mark scheme page that also exists as text.
   */
  fallback?: ReactNode;
  /**
   * Stretched to fill a positioned parent that already has the right shape,
   * rather than laid out by its own width.
   *
   * This is how a page of the paper is drawn under an ink layer: the sheet
   * decides the page's size from the asset's own dimensions, and the image has
   * to land on exactly that box or the writing sits somewhere the print is not.
   */
  fill?: boolean;
  /**
   * The image's own pixel size, when it is known before the bytes arrive.
   *
   * Without it the placeholder has to guess, and it guessed 4:3 -- so every
   * page of a paper, which is nothing like 4:3, jumped to its real height the
   * moment it loaded and took the page under it along.
   */
  width?: number;
  height?: number;
  /**
   * Kept for the life of the tab, so the same image is not fetched twice.
   *
   * For pages of the paper, which a student turns back and forth through while
   * answering. Not for one-off evidence -- a frozen working image is looked at
   * once and should not sit in memory afterwards.
   */
  cache?: boolean;
  onReady?(): void;
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
    const load = async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("image_unavailable");
      const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("image_unavailable");
      return response.blob();
    };

    if (cache) {
      const held = acquireCachedImageUrl(path, load);
      void held.url
        .then((value) => active && setUrl(value))
        .catch(() => active && setFailedAttempt(attempt));
      return () => {
        active = false;
        held.release();
      };
    }

    let objectUrl = "";
    void load()
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
  }, [attempt, cache, path]);

  if (failed && fallback) return <>{fallback}</>;
  if (failed) {
    /*
     * A figure that will not load can make a question unanswerable, and the
     * usual cause is a dropped request rather than a missing file -- so this
     * offers the one thing that fixes that, instead of a dead end.
     */
    return (
      <div
        className={`grid place-items-center gap-2 bg-[var(--color-glass-subtle)] p-3 text-center ${
          fill ? "absolute inset-0" : "rounded-2xl"
        } ${className}`}
      >
        <p className="text-sm text-text-muted">This image could not be loaded.</p>
        <button
          type="button"
          className="text-sm font-medium text-accent underline-offset-2 hover:underline"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!url) {
    return (
      <div
        aria-hidden="true"
        className={`animate-pulse bg-[var(--color-glass-subtle)] ${
          fill ? "absolute inset-0" : width && height ? "rounded-2xl" : "min-h-40 rounded-2xl"
        } ${className}`}
        style={fill || !width || !height ? undefined : { aspectRatio: `${width} / ${height}` }}
      />
    );
  }
  return (
    // A blob URL from the session-authorised route, so next/image cannot help.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      onLoad={onReady}
      className={
        fill
          ? `absolute inset-0 h-full w-full ${className} ${imageClassName}`
          : `h-auto w-full object-contain ${className} ${imageClassName}`
      }
    />
  );
}
