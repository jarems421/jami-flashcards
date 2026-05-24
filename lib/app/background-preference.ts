"use client";

export const APP_BACKGROUND_STORAGE_KEY = "jami:app-background";
export const APP_BACKGROUND_EVENT = "jami-app-background-change";

export type AppBackgroundPreference = "purple-pink" | "paper-white" | "soft-grey";

export const APP_BACKGROUND_OPTIONS: Array<{
  value: AppBackgroundPreference;
  label: string;
  description: string;
  preview: string;
}> = [
  {
    value: "purple-pink",
    label: "Purple pink",
    description: "The warmer classic Jami glow.",
    preview: "linear-gradient(135deg,#ffb8e8 0%,#b28cff 48%,#1b102f 100%)",
  },
  {
    value: "paper-white",
    label: "White",
    description: "A clean pale study desk.",
    preview: "linear-gradient(135deg,#ffffff 0%,#f7edf8 54%,#e9e7ff 100%)",
  },
  {
    value: "soft-grey",
    label: "Grey",
    description: "A quieter neutral workspace.",
    preview: "linear-gradient(135deg,#f4f6f9 0%,#cfd5df 54%,#657080 100%)",
  },
];

export function readAppBackgroundPreference(): AppBackgroundPreference {
  if (typeof window === "undefined") return "purple-pink";

  try {
    const value = localStorage.getItem(APP_BACKGROUND_STORAGE_KEY);
    if (
      value === "purple-pink" ||
      value === "paper-white" ||
      value === "soft-grey"
    ) {
      return value;
    }
  } catch {
    // Non-critical local preference.
  }

  return "purple-pink";
}

export function saveAppBackgroundPreference(value: AppBackgroundPreference) {
  try {
    localStorage.setItem(APP_BACKGROUND_STORAGE_KEY, value);
  } catch {
    // Non-critical local preference.
  }

  window.dispatchEvent(new Event(APP_BACKGROUND_EVENT));
}

