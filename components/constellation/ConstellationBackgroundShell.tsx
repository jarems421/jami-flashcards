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
  APP_BACKGROUND_EVENT,
  readAppBackgroundPreference,
  type AppBackgroundPreference,
} from "@/lib/app/background-preference";

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
  const [appBackground, setAppBackground] =
    useState<AppBackgroundPreference>("purple-pink");

  useEffect(() => {
    const syncAppBackgroundPreference = () => {
      setAppBackground(readAppBackgroundPreference());
    };

    syncAppBackgroundPreference();
    window.addEventListener("storage", syncAppBackgroundPreference);
    window.addEventListener(APP_BACKGROUND_EVENT, syncAppBackgroundPreference);

    return () => {
      window.removeEventListener("storage", syncAppBackgroundPreference);
      window.removeEventListener(APP_BACKGROUND_EVENT, syncAppBackgroundPreference);
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
    document.body.classList.toggle("app-background-purple-pink", appBackground === "purple-pink");
    document.body.classList.toggle("app-background-paper-white", appBackground === "paper-white");
    document.body.classList.toggle("app-background-soft-grey", appBackground === "soft-grey");

    return () => {
      document.body.classList.remove(
        "app-background-purple-pink",
        "app-background-paper-white",
        "app-background-soft-grey"
      );
    };
  }, [appBackground]);

  useEffect(() => {
    document.body.classList.toggle(
      "constellation-background-enabled",
      shouldShowBackground
    );

    return () => {
      document.body.classList.remove("constellation-background-enabled");
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

