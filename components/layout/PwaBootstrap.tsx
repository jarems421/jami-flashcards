"use client";

import { useEffect } from "react";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { ensureServiceWorkerRegistration } from "@/services/notifications";

export default function PwaBootstrap() {
  useAppUpdate();

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "true") {
      return;
    }

    void ensureServiceWorkerRegistration().catch((error) => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Failed to register service worker", error);
      }
    });
  }, []);

  return null;
}
