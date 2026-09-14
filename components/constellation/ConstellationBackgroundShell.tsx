"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import ConstellationBackgroundErrorBoundary from "@/components/constellation/ConstellationBackgroundErrorBoundary";
import {
  allowsConstellationBackground,
  CONSTELLATION_BACKGROUND_EVENT,
  readConstellationBackgroundCrashMarked,
  readConstellationBackgroundConstellationId,
  readConstellationBackgroundEnabled,
} from "@/lib/constellation/background";
import {
  APP_THEME_CLASS_NAMES,
  APP_THEME_EVENT,
  getActiveAppThemeClassNames,
  readAppThemePreference,
  type AppThemePreference,
} from "@/lib/app/theme-preference";
import {
  getPhotoBackgroundClassNames,
  PHOTO_BACKGROUND_CLASS_NAMES,
  PHOTO_BACKGROUND_EVENT,
  PHOTO_BACKGROUND_VAR_NAMES,
  photoBackgroundImageValue,
  photoBackgroundPosition,
  readPhotoBackground,
  type CachedPhotoBackground,
} from "@/lib/app/photo-background";

const ConstellationBackground = dynamic(
  () => import("@/components/constellation/ConstellationBackground"),
  { ssr: false }
);

type ConstellationBackgroundShellProps = {
  children: React.ReactNode;
};

export default function ConstellationBackgroundShell({
  children,
}: ConstellationBackgroundShellProps) {
  const pathname = usePathname();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isCrashMarked, setIsCrashMarked] = useState(false);
  const [backgroundConstellationId, setBackgroundConstellationId] = useState("");
  const [isBackgroundReady, setIsBackgroundReady] = useState(false);
  const [appTheme, setAppTheme] =
    useState<AppThemePreference>("normal");
  /*
   * Read at once rather than from an effect. The blocking script has already
   * painted this photo, and an effect that started from null would strip it
   * for a frame. Nothing rendered depends on it, so there is no markup for
   * hydration to disagree about.
   */
  const [photoBackground, setPhotoBackground] =
    useState<CachedPhotoBackground | null>(() => readPhotoBackground());

  useEffect(() => {
    const syncPhotoBackground = () => {
      setPhotoBackground(readPhotoBackground());
    };

    window.addEventListener("storage", syncPhotoBackground);
    window.addEventListener(PHOTO_BACKGROUND_EVENT, syncPhotoBackground);

    return () => {
      window.removeEventListener("storage", syncPhotoBackground);
      window.removeEventListener(PHOTO_BACKGROUND_EVENT, syncPhotoBackground);
    };
  }, []);

  useEffect(() => {
    const syncAppThemePreference = () => {
      setAppTheme(readAppThemePreference());
    };

    syncAppThemePreference();
    window.addEventListener("storage", syncAppThemePreference);
    window.addEventListener(APP_THEME_EVENT, syncAppThemePreference);

    return () => {
      window.removeEventListener("storage", syncAppThemePreference);
      window.removeEventListener(APP_THEME_EVENT, syncAppThemePreference);
    };
  }, []);

  useEffect(() => {
    const syncBackgroundPreference = () => {
      setIsEnabled(readConstellationBackgroundEnabled());
      setIsCrashMarked(readConstellationBackgroundCrashMarked());
      setBackgroundConstellationId(readConstellationBackgroundConstellationId());
    };

    syncBackgroundPreference();
    window.addEventListener("storage", syncBackgroundPreference);
    window.addEventListener(
      CONSTELLATION_BACKGROUND_EVENT,
      syncBackgroundPreference as EventListener
    );

    return () => {
      window.removeEventListener("storage", syncBackgroundPreference);
      window.removeEventListener(
        CONSTELLATION_BACKGROUND_EVENT,
        syncBackgroundPreference as EventListener
      );
    };
  }, []);

  /*
   * Which routes show a background, on one rule shared with the blocking script
   * that stamps its class before the first paint. See the list itself for why
   * notebooks are not among them.
   */
  const allowsBackground =
    // Typed as a string, but null with no router above this -- a test harness,
    // or a tree rendered outside the app shell.
    allowsConstellationBackground(pathname ?? "");
  const showsSky = isEnabled && !isCrashMarked && allowsBackground;
  /*
   * A photo shows wherever the sky does not. Both being on means the sky was
   * turned on after the photo was chosen -- choosing a photo turns the sky off
   * -- so the later choice wins on this device.
   */
  const photo = !showsSky && allowsBackground ? photoBackground : null;
  /** Either background brings its own palette, so the colour theme stands aside. */
  const shouldShowBackground = showsSky || Boolean(photo);

  useEffect(() => {
    if (!showsSky || isBackgroundReady) {
      return;
    }

    let cancelled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let idleHandle: number | null = null;

    if ("requestIdleCallback" in window) {
      idleHandle = window.requestIdleCallback(() => {
        if (!cancelled) {
          setIsBackgroundReady(true);
        }
      });
    } else {
      timeoutHandle = globalThis.setTimeout(() => {
        if (!cancelled) {
          setIsBackgroundReady(true);
        }
      }, 180);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        globalThis.clearTimeout(timeoutHandle);
      }
    };
  }, [isBackgroundReady, showsSky]);

  /*
   * The sky brings its own colours, so no theme class is stamped while it is on.
   *
   * The star field used to sit under whichever colour theme was selected, which
   * gave a black sky pink buttons and a blush nav -- and, for the two light
   * themes, the `app-theme-light` rules that turn hard-coded white text dark,
   * against panels that are still dark. Every one of those is a class on the
   * document rather than a custom property, so no amount of overriding in
   * `.constellation-background-enabled` reaches them; not stamping the class is
   * what actually settles it. The palette itself lives in globals.css beside
   * the surfaces it belongs to.
   */
  useEffect(() => {
    const themeTargets = [document.documentElement, document.body];
    const activeClassNames = new Set(
      shouldShowBackground ? [] : getActiveAppThemeClassNames(appTheme)
    );

    for (const target of themeTargets) {
      for (const className of APP_THEME_CLASS_NAMES) {
        target.classList.toggle(className, activeClassNames.has(className));
      }
    }

    return () => {
      for (const target of themeTargets) {
        target.classList.remove(...APP_THEME_CLASS_NAMES);
      }
    };
  }, [appTheme, shouldShowBackground]);

  useEffect(() => {
    const backgroundTargets = [document.documentElement, document.body];

    for (const target of backgroundTargets) {
      target.classList.toggle(
        "constellation-background-enabled",
        showsSky
      );
    }

    return () => {
      for (const target of backgroundTargets) {
        target.classList.remove("constellation-background-enabled");
      }
    };
  }, [showsSky]);

  /*
   * The photo and its palette, the same way the blocking script applies them.
   * The palette's values go on the root element, where globals.css reads them
   * into every app colour; the photo itself is painted by a fixed layer there
   * too, because iPad Safari ignores fixed backgrounds on the body.
   */
  useEffect(() => {
    const root = document.documentElement;
    const active = photo ? getPhotoBackgroundClassNames(photo.scheme) : [];

    for (const target of [root, document.body]) {
      for (const className of PHOTO_BACKGROUND_CLASS_NAMES) {
        target.classList.toggle(className, active.includes(className));
      }
    }
    if (photo) {
      for (const name of PHOTO_BACKGROUND_VAR_NAMES) {
        root.style.setProperty(name, photo.vars[name]);
      }
      root.style.setProperty("--photo-image", photoBackgroundImageValue(photo.imageUrl));
      root.style.setProperty("--photo-position", photoBackgroundPosition(photo));
      root.style.setProperty("--photo-zoom", String(photo.zoom));
    }

    return () => {
      for (const target of [root, document.body]) {
        target.classList.remove(...PHOTO_BACKGROUND_CLASS_NAMES);
      }
      for (const name of [...PHOTO_BACKGROUND_VAR_NAMES, "--photo-image", "--photo-position", "--photo-zoom"]) {
        root.style.removeProperty(name);
      }
    };
  }, [photo]);

  return (
    <>
      {showsSky ? (
        <ConstellationBackgroundErrorBoundary>
          {isBackgroundReady ? (
            <ConstellationBackground
              selectedConstellationId={backgroundConstellationId}
            />
          ) : null}
        </ConstellationBackgroundErrorBoundary>
      ) : null}
      <div className="relative z-10 flex min-h-full flex-col">{children}</div>
    </>
  );
}

