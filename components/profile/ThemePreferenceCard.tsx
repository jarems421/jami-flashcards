"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@/components/providers/UserProvider";
import { Card, SectionHeader } from "@/components/ui";
import {
  APP_THEME_OPTIONS,
  readAppThemePreference,
  type AppThemePreference,
} from "@/lib/app/theme-preference";
import { updateAppearance } from "@/services/profile/appearance";
import {
  CONSTELLATION_BACKGROUND_EVENT,
  readConstellationBackgroundCrashMarked,
  readConstellationBackgroundEnabled,
} from "@/lib/constellation/background";
import { PHOTO_BACKGROUND_EVENT, readPhotoBackground } from "@/lib/app/photo-background";

/**
 * Lifted out of the Account page when Account split into two views: the
 * swatches open the Personalise view now, and the page they came from is about
 * sign-in and data.
 */
export default function ThemePreferenceCard() {
  const { user } = useUser();
  const [selectedTheme, setSelectedTheme] = useState<AppThemePreference>(() =>
    readAppThemePreference(),
  );
  const [skyIsOn, setSkyIsOn] = useState(false);
  const [photoIsOn, setPhotoIsOn] = useState(false);

  /*
   * The sky is a preset of its own and brings its own black palette, so while
   * it is on these six swatches change nothing. Saying so is the difference
   * between a setting that is off and a setting that looks broken.
   */
  useEffect(() => {
    const syncSky = () => {
      setSkyIsOn(
        readConstellationBackgroundEnabled() &&
          !readConstellationBackgroundCrashMarked(),
      );
      setPhotoIsOn(Boolean(readPhotoBackground()));
    };

    syncSky();
    window.addEventListener("storage", syncSky);
    window.addEventListener(CONSTELLATION_BACKGROUND_EVENT, syncSky);
    window.addEventListener(PHOTO_BACKGROUND_EVENT, syncSky);

    return () => {
      window.removeEventListener("storage", syncSky);
      window.removeEventListener(CONSTELLATION_BACKGROUND_EVENT, syncSky);
      window.removeEventListener(PHOTO_BACKGROUND_EVENT, syncSky);
    };
  }, []);

  const handleSelectTheme = (value: AppThemePreference) => {
    setSelectedTheme(value);
    void updateAppearance(user.uid, { theme: value }).catch((error: unknown) => {
      console.warn("Could not save the theme to your account.", error);
    });
  };

  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Appearance"
        title="Choose your study atmosphere"
        description="Saved to your account, so Jami looks the same on every device you sign into."
      />
      {skyIsOn ? (
        <p className="app-subtle-panel mt-4 rounded-lg px-3 py-2.5 text-sm leading-6">
          Your star sky is on, so Jami is black everywhere to keep the stars the
          only colour on screen. Pick a colour here and it comes back when you
          remove the background from{" "}
          <Link
            href="/dashboard/constellation"
            className="font-semibold text-text-primary underline underline-offset-2"
          >
            Stars
          </Link>
          .
        </p>
      ) : photoIsOn ? (
        <p className="app-subtle-panel mt-4 rounded-lg px-3 py-2.5 text-sm leading-6">
          Your photo background is on, so Jami takes its colours from the
          photo. Pick a colour here and it comes back when you remove the photo
          below.
        </p>
      ) : null}
      {/*
        Read as a palette rather than a list of settings: the swatch is the
        content, the name labels it, and the description moves to the button's
        title and accessible name so screen readers keep it without the grid
        turning into a wall of text at six options.
      */}
      <div
        role="radiogroup"
        aria-label="App theme"
        className="mt-5 grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-6"
      >
        {APP_THEME_OPTIONS.map((option) => {
          const active = selectedTheme === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={option.description}
              aria-label={`${option.label}. ${option.description}`}
              onClick={() => handleSelectTheme(option.value)}
              className="group flex flex-col items-center gap-2 rounded-lg p-1.5 outline-none transition duration-fast focus-visible:ring-2 focus-visible:ring-accent/45"
            >
              <span
                className={`relative grid aspect-square w-full max-w-[3.75rem] place-items-center rounded-full border-2 transition duration-fast ${
                  active
                    ? "border-[var(--color-accent)] shadow-ring"
                    : "border-[var(--color-border)] group-hover:border-border-strong"
                }`}
                style={{ backgroundImage: option.preview }}
                aria-hidden="true"
              >
                {/*
                  The tick sits on a filled accent disc rather than straight on
                  the swatch: a check alone disappears against the White and
                  Pink previews, and tinting it per option would need a
                  contrast decision for every future theme. It is drawn in the
                  accent's own text colour, so a light accent gets a dark tick.
                */}
                {active ? (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--color-accent)] text-accent-on shadow-e0">
                    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                      <path
                        d="m5 10.5 3.4 3.4L15 7.2"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                ) : null}
              </span>
              <span
                className={`text-center text-xs font-semibold leading-4 transition duration-fast ${
                  active
                    ? "text-text-primary"
                    : "text-text-muted group-hover:text-text-primary"
                }`}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
