"use client";

import { useEffect } from "react";
import { ensureServiceWorkerRegistration } from "@/services/notifications";

export default function PwaBootstrap() {
  useEffect(() => {
    void ensureServiceWorkerRegistration().catch((error) => {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Failed to register service worker", error);
      }
    });
  }, []);

  return null;
}