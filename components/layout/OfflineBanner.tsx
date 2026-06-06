"use client";

import { useEffect, useState } from "react";

export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const updateStatus = () => setOffline(!navigator.onLine);
    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed left-4 right-4 z-[80] mx-auto max-w-xl rounded-[1.15rem] border border-warm-border bg-surface-panel-strong px-4 py-3 text-sm text-text-secondary shadow-[0_18px_48px_rgba(0,0,0,0.38)]"
      style={{
        bottom:
          "calc(env(safe-area-inset-bottom, 0px) + clamp(1rem, 12vw, 6.5rem))",
      }}
    >
      <span className="font-semibold text-text-primary">You are offline.</span>{" "}
      Saved review cards remain available; other changes may need retrying when
      you reconnect.
    </div>
  );
}
