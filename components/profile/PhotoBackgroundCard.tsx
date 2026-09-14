"use client";

import { useEffect, useRef, useState } from "react";
import PhotoBackgroundPositioner from "@/components/profile/PhotoBackgroundPositioner";
import { useUser } from "@/components/providers/UserProvider";
import { Button, Card, SectionHeader } from "@/components/ui";
import {
  PHOTO_BACKGROUND_EVENT,
  readPhotoBackground,
  type CachedPhotoBackground,
  type PhotoBackgroundView,
} from "@/lib/app/photo-background";
import {
  CONSTELLATION_BACKGROUND_EVENT,
  readConstellationBackgroundCrashMarked,
  readConstellationBackgroundEnabled,
} from "@/lib/constellation/background";
import {
  photoBackgroundErrorMessage,
  removePhotoBackground,
  savePhotoBackground,
  savePhotoBackgroundView,
} from "@/services/profile/photo-background";

/**
 * Choosing a photo to study in front of, and which part of it shows.
 *
 * There is no colour to pick here on purpose: the colours come from the photo,
 * measured so text stays readable over it, and the preview shows the result
 * rather than asking the student to predict it.
 */
export default function PhotoBackgroundCard() {
  const { user } = useUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [background, setBackground] = useState<CachedPhotoBackground | null>(null);
  const [skyIsOn, setSkyIsOn] = useState(false);
  const [phase, setPhase] = useState<"saving" | "positioning" | "removing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      const cached = readPhotoBackground();
      setBackground(cached?.userId === user.uid ? cached : null);
      setSkyIsOn(readConstellationBackgroundEnabled() && !readConstellationBackgroundCrashMarked());
    };

    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(PHOTO_BACKGROUND_EVENT, sync);
    window.addEventListener(CONSTELLATION_BACKGROUND_EVENT, sync);

    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(PHOTO_BACKGROUND_EVENT, sync);
      window.removeEventListener(CONSTELLATION_BACKGROUND_EVENT, sync);
    };
  }, [user.uid]);

  const choose = async (file: File | undefined) => {
    if (!file || phase) return;
    setPhase("saving");
    setError(null);
    try {
      await savePhotoBackground(user.uid, file);
    } catch (saveError) {
      console.error("Failed to save photo background.", saveError);
      setError(photoBackgroundErrorMessage(saveError));
    } finally {
      setPhase(null);
    }
  };

  const savePosition = async (view: PhotoBackgroundView) => {
    if (phase) return;
    setPhase("positioning");
    setError(null);
    try {
      await savePhotoBackgroundView(user.uid, view);
    } catch (positionError) {
      console.error("Failed to save photo background position.", positionError);
      setError(photoBackgroundErrorMessage(positionError));
    } finally {
      setPhase(null);
    }
  };

  const remove = async () => {
    if (phase) return;
    setPhase("removing");
    setError(null);
    try {
      await removePhotoBackground(user.uid);
    } catch (removeError) {
      console.error("Failed to remove photo background.", removeError);
      setError("Your background could not be removed. Please try again.");
    } finally {
      setPhase(null);
    }
  };

  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Background"
        title="Study in front of your own photo"
        description="Jami picks readable colours from the photo for you. Saved to your account, so it follows you to every device."
      />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {skyIsOn ? (
        <p className="app-subtle-panel mt-4 rounded-lg px-3 py-2.5 text-sm leading-6">
          {background
            ? "Your star sky is on on this device, so it shows instead of your photo. Choosing a photo turns the sky off here."
            : "Choosing a photo turns your star sky off on this device."}
        </p>
      ) : null}

      {background ? (
        <div className="mt-5 space-y-4">
          {/* Keyed on the saved record, so a save or a photo chosen elsewhere starts the editor from it. */}
          <PhotoBackgroundPositioner
            key={`${background.storagePath}:${background.updatedAt}`}
            background={background}
            saving={phase === "positioning"}
            onSave={(view) => void savePosition(view)}
          />
          <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={phase !== null}
              onClick={() => inputRef.current?.click()}
            >
              {phase === "saving" ? "Saving photo…" : "Replace photo"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={phase !== null}
              onClick={() => void remove()}
            >
              {phase === "removing" ? "Removing…" : "Remove photo"}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={phase !== null}
          onClick={() => inputRef.current?.click()}
          className="mt-5 flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--color-border-strong)] px-4 py-8 text-center transition duration-fast hover:border-accent/50 hover:bg-[var(--color-glass-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-7 w-7 text-text-muted"
          >
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="m4.5 17 5-5 3.5 3.5 2.5-2.5 4 4" />
          </svg>
          <span className="text-sm font-semibold text-text-primary">
            {phase === "saving" ? "Saving photo…" : "Choose a photo"}
          </span>
          <span className="text-xs text-text-muted">
            Any photo works. Large ones are resized for you.
          </span>
        </button>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-danger-text">
          {error}
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-text-muted">
        Notebooks and past-paper questions keep a plain background, so nothing sits behind your writing.
      </p>
    </Card>
  );
}
