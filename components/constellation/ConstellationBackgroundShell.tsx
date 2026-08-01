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

  useEffect(() => {
    const themeTargets = [document.documentElement, document.body];
    const activeClassNames = new Set(getActiveAppThemeClassNames(appTheme));

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
  }, [appTheme]);

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

