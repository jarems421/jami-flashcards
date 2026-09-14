"use client";

import { useEffect, useRef, useState } from "react";
import PanelStyleSetting from "@/components/profile/PanelStyleSetting";
import PhotoBackgroundPositioner from "@/components/profile/PhotoBackgroundPositioner";
import { useUser } from "@/components/providers/UserProvider";
import { Button, Card } from "@/components/ui";
import {
  isEnlargedPhotoBackground,
  isSoftPhotoBackground,
  LOW_RESOLUTION_PHOTO_STRETCH,
  PHOTO_BACKGROUND_EVENT,
  photoBackgroundImageValue,
  photoBackgroundPosition,
  photoBackgroundStretch,
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
 * Kept compact on purpose: it sits in Account beside settings that matter more,
 * so the photo is a thumbnail with its actions, and positioning opens only when
 * asked for. There is no colour to pick: the colours come from the photo,
 * measured so text stays readable over it.
 */
export default function PhotoBackgroundCard() {
  const { user } = useUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [background, setBackground] = useState<CachedPhotoBackground | null>(null);
  const [skyIsOn, setSkyIsOn] = useState(false);
  const [phase, setPhase] = useState<"saving" | "positioning" | "removing" | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ url: string; width: number; height: number } | null>(null);
  const [screen, setScreen] = useState({ width: 1440, height: 900, pixelRatio: 1 });

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

  // The stored photo's real size, so the card can explain a blurry background.
  useEffect(() => {
    if (!background) return;
    const url = background.imageUrl;
    const image = new Image();
    image.onload = () => setImageSize({ url, width: image.naturalWidth, height: image.naturalHeight });
    image.src = url;
    return () => {
      image.onload = null;
    };
  }, [background]);

  useEffect(() => {
    const measure = () =>
      setScreen({
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: window.devicePixelRatio || 1,
      });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const measuredImage = background && imageSize?.url === background.imageUrl ? imageSize : null;
  const stretch =
    background && measuredImage
      ? photoBackgroundStretch({
          imageWidth: measuredImage.width,
          imageHeight: measuredImage.height,
          screenWidth: screen.width,
          screenHeight: screen.height,
          pixelRatio: screen.pixelRatio,
          zoom: background.zoom,
        })
      : 1;

  const choose = async (file: File | undefined) => {
    if (!file || phase) return;
    setPhase("saving");
    setError(null);
    try {
      await savePhotoBackground(user.uid, file);
      setAdjusting(false);
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
      setAdjusting(false);
    } catch (removeError) {
      console.error("Failed to remove photo background.", removeError);
      setError("Your background could not be removed. Please try again.");
    } finally {
      setPhase(null);
    }
  };

  const notice = !background
    ? null
    : measuredImage && stretch > LOW_RESOLUTION_PHOTO_STRETCH
      ? `This image is only ${measuredImage.width} × ${measuredImage.height}, so it's stretched about ${Math.round(stretch)}× to fill your screen. A larger version will look sharper.`
      : isEnlargedPhotoBackground(background.storagePath)
        ? "This photo was smaller than your screen, so Jami enlarged it and softened it a little. A larger photo will look sharper."
        : isSoftPhotoBackground(background.storagePath)
          ? "Saved before backgrounds were sharpened. Replace it with the same photo for full quality."
          : null;

  return (
    <Card padding="md">
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

      <div className="flex flex-wrap items-center gap-3">
        {background ? (
          <div
            aria-hidden="true"
            className="h-12 w-16 shrink-0 rounded-lg border border-[var(--color-border)] bg-cover"
            style={{
              backgroundColor: background.vars["--photo-base"],
              backgroundImage: photoBackgroundImageValue(background.imageUrl),
              backgroundPosition: photoBackgroundPosition(background),
            }}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-text-primary">Background photo</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {phase === "saving"
              ? "Preparing your photo…"
              : skyIsOn
                ? "Your star sky is on here, so it shows instead."
                : "Colours are picked from it. Follows you to every device."}
          </p>
        </div>
        {background ? (
        // Beside the title where there is room; underneath it on a phone.
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-expanded={adjusting}
            disabled={phase !== null}
            onClick={() => setAdjusting((open) => !open)}
          >
            {adjusting ? "Done" : "Adjust"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={phase !== null}
            onClick={() => inputRef.current?.click()}
          >
            {phase === "saving" ? "Saving…" : "Replace"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={phase !== null}
            onClick={() => void remove()}
          >
            {phase === "removing" ? "Removing…" : "Remove"}
          </Button>
        </div>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={phase !== null}
            onClick={() => inputRef.current?.click()}
            className="shrink-0"
          >
            {phase === "saving" ? "Saving…" : "Choose photo"}
          </Button>
        )}
      </div>

      {notice ? <p className="mt-3 text-xs leading-5 text-text-muted">{notice}</p> : null}

      {background && adjusting ? (
        <div className="mt-4">
          {/* Keyed on the saved record, so a save or a photo chosen elsewhere starts the editor from it. */}
          <PhotoBackgroundPositioner
            key={`${background.storagePath}:${background.updatedAt}`}
            background={background}
            saving={phase === "positioning"}
            onSave={(view) => void savePosition(view)}
          />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-danger-text">
          {error}
        </p>
      ) : null}

      {/* For whichever background is showing: the photo, or the star sky. */}
      {background || skyIsOn ? (
        <PanelStyleSetting className="mt-4 border-t border-[var(--color-border)] pt-4" />
      ) : null}
    </Card>
  );
}
