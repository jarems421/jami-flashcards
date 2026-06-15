"use client";

import { useCallback, useEffect, useState } from "react";

export function readDisclosurePreference(
  key: string,
  defaultOpen: boolean,
): boolean {
  if (typeof window === "undefined") return defaultOpen;

  try {
    const storedValue = localStorage.getItem(key);
    return storedValue === null ? defaultOpen : storedValue === "true";
  } catch {
    return defaultOpen;
  }
}

export function saveDisclosurePreference(key: string, open: boolean) {
  try {
    localStorage.setItem(key, open ? "true" : "false");
  } catch {
    // Non-critical local layout preference.
  }
}

export function usePersistentDisclosure(key: string, defaultOpen: boolean) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(readDisclosurePreference(key, defaultOpen));
  }, [defaultOpen, key]);

  const toggle = useCallback(() => {
    setOpen((currentOpen) => {
      const nextOpen = !currentOpen;
      saveDisclosurePreference(key, nextOpen);
      return nextOpen;
    });
  }, [key]);

  return [open, toggle] as const;
}
