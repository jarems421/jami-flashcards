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
   * Notebooks are excluded again, and this time the reason is written down.
   *
   * They were excluded when the notebook viewport was rewritten, with no note
   * saying why. I removed the exclusion on 1 September because page colours are
   * solid, so stars can only ever sit around the paper -- which is true of
   * painting, and beside the point.
   *
   * The background does not just paint. It mounts on an idle callback, well
   * after the page has rendered, and when it arrives it toggles classes on
   * <html> and <body>: constellation-background-enabled goes on and the theme
   * class comes off. A notebook sizes its page by measuring its frame and
   * fitting the sheet into it, so a class flip that lands after that
   * measurement is exactly the shape of "all the writing is squashed into a
   * mini page in the corner" -- which is what a student reported the next day,
   * on the one account where the background was on.
   *
   * That is a diagnosis by timing and coincidence rather than a reproduction,
   * so it is not proof. It is enough to stop showing a decorative sky over
   * someone's handwriting until it is proof: notebooks are where the work is,
   * and stars behind them buy nothing worth this risk.
   */
  const shouldShowBackground =
    isEnabled &&
    !isCrashMarked &&
    !pathname.startsWith("/dashboard/notebooks/") &&
    pathname !== "/dashboard/constellation";

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

