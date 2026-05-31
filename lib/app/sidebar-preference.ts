"use client";

export const SIDEBAR_HIDDEN_STORAGE_KEY = "jami:sidebar-hidden";

export function readSidebarHiddenPreference(): boolean {
  if (typeof window === "undefined") return false;

  try {
    return localStorage.getItem(SIDEBAR_HIDDEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveSidebarHiddenPreference(hidden: boolean) {
  try {
    localStorage.setItem(SIDEBAR_HIDDEN_STORAGE_KEY, hidden ? "true" : "false");
  } catch {
    // Non-critical local layout preference.
  }
}
