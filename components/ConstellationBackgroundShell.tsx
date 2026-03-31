"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import ConstellationBackground from "@/components/ConstellationBackground";
import ConstellationBackgroundErrorBoundary from "@/components/ConstellationBackgroundErrorBoundary";
import {
  CONSTELLATION_BACKGROUND_EVENT,
  readConstellationBackgroundCrashMarked,
  readConstellationBackgroundConstellationId,
  readConstellationBackgroundEnabled,
} from "@/lib/constellation-background";

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
          <ConstellationBackground
            selectedConstellationId={backgroundConstellationId}
          />
        </ConstellationBackgroundErrorBoundary>
      ) : null}
      <div className="relative z-10 flex min-h-full flex-col">{children}</div>
    </>
  );
}
