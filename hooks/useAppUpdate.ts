"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  alreadyReloadedFor,
  APP_BUILD,
  hasUnsavedWork,
  isOutdatedBuild,
  mayReloadForUpdate,
  type AppUpdateMoment,
} from "@/lib/app/app-build";
import { clearCachedBuild, fetchDeployedBuild } from "@/services/app/app-update";

const RELOADED_FOR_KEY = "jami:app-update-reloaded-for";
/** Returning to the app and changing page are frequent; the server need not be asked each time. */
const RECHECK_AFTER_MS = 30_000;

function readReloadedFor() {
  try {
    return window.sessionStorage.getItem(RELOADED_FOR_KEY);
  } catch {
    return null;
  }
}

function writeReloadedFor(build: string | null) {
  try {
    if (build) window.sessionStorage.setItem(RELOADED_FOR_KEY, build);
    else window.sessionStorage.removeItem(RELOADED_FOR_KEY);
  } catch {
    // Without session storage the loop guard is lost, not the update.
  }
}

/**
 * Moves an installed app onto the deployed build: on launch, on each page
 * change, and on coming back to it, whenever `mayReloadForUpdate` says the
 * moment is free. See `lib/app/app-build.ts`.
 */
export function useAppUpdate() {
  const pathname = usePathname() ?? "";
  const pathnameRef = useRef(pathname);
  const lastCheckRef = useRef(0);
  const checkingRef = useRef(false);

  const checkRef = useRef(async (moment: AppUpdateMoment) => {
    if (!APP_BUILD || checkingRef.current) return;
    if (moment !== "launch" && Date.now() - lastCheckRef.current < RECHECK_AFTER_MS) return;
    checkingRef.current = true;
    lastCheckRef.current = Date.now();
    try {
      const deployed = await fetchDeployedBuild();
      if (!isOutdatedBuild(APP_BUILD, deployed)) {
        if (deployed === APP_BUILD) writeReloadedFor(null);
        return;
      }
      if (alreadyReloadedFor(deployed, readReloadedFor())) return;
      if (
        !mayReloadForUpdate({
          moment,
          pathname: pathnameRef.current,
          unsavedWork: hasUnsavedWork(),
        })
      ) {
        // Not now; the next launch, page change or return asks again.
        lastCheckRef.current = 0;
        return;
      }
      writeReloadedFor(deployed);
      await clearCachedBuild();
      window.location.reload();
    } finally {
      checkingRef.current = false;
    }
  });

  useEffect(() => {
    void checkRef.current("launch");
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void checkRef.current("resume");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (pathnameRef.current === pathname) return;
    pathnameRef.current = pathname;
    void checkRef.current("navigation");
  }, [pathname]);
}
