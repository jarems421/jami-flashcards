"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import ConstellationBackgroundErrorBoundary from "@/components/constellation/ConstellationBackgroundErrorBoundary";
import {
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
   * Notebooks show the sky too, if the student turned it on.
   *
   * They were excluded when the notebook viewport was rewritten, with no note
   * saying why -- most likely to keep anything animated away from the ink
   * canvas. Page colours are solid, so the sheet stays opaque and the stars sit
   * around the paper rather than under the writing.
   *
   * The constellation page is still excluded, and for a reason that has not
   * changed: it draws the same sky in the middle of the page, and a second copy
   * of it behind that is just noise.
   */
  const shouldShowBackground =
    isEnabled && !isCrashMarked && pathname !== "/dashboard/constellation";

  useEffect(() => {
    if (!shouldShowBackground || isBackgroundReady) {
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
  }, [isBackgroundReady, shouldShowBackground]);

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
        shouldShowBackground
      );
    }

    return () => {
      for (const target of backgroundTargets) {
        target.classList.remove("constellation-background-enabled");
      }
    };
  }, [shouldShowBackground]);

  return (
    <>
      {shouldShowBackground ? (
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

