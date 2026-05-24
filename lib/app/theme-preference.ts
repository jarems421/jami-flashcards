"use client";

export const APP_THEME_STORAGE_KEY = "jami:app-theme";
export const LEGACY_APP_BACKGROUND_STORAGE_KEY = "jami:app-background";
export const APP_THEME_EVENT = "jami-app-theme-change";

export type AppThemePreference =
  | "normal"
  | "purple-pink"
  | "paper-white"
  | "soft-grey";

export const APP_THEME_OPTIONS: Array<{
  value: AppThemePreference;
  label: string;
  description: string;
  preview: string;
}> = [
  {
    value: "normal",
    label: "Normal",
    description: "The calm blue-grey Jami default.",
    preview: "linear-gradient(135deg,#111827 0%,#182033 52%,#0d1018 100%)",
  },
  {
    value: "purple-pink",
    label: "Purple pink",
    description: "A warmer Jami glow.",
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
    description: "A quiet neutral workspace.",
    preview: "linear-gradient(135deg,#f4f6f9 0%,#cfd5df 54%,#657080 100%)",
  },
];

function isAppThemePreference(value: unknown): value is AppThemePreference {
  return (
    value === "normal" ||
    value === "purple-pink" ||
    value === "paper-white" ||
    value === "soft-grey"
  );
}

export function readAppThemePreference(): AppThemePreference {
  if (typeof window === "undefined") return "normal";

  try {
    const value = localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (isAppThemePreference(value)) return value;

    const legacyValue = localStorage.getItem(LEGACY_APP_BACKGROUND_STORAGE_KEY);
    if (isAppThemePreference(legacyValue)) return legacyValue;
  } catch {
    // Non-critical local display preference.
  }

  return "normal";
}

export function saveAppThemePreference(value: AppThemePreference) {
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, value);
    localStorage.removeItem(LEGACY_APP_BACKGROUND_STORAGE_KEY);
  } catch {
    // Non-critical local display preference.
  }

  window.dispatchEvent(new Event(APP_THEME_EVENT));
}

