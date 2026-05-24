"use client";

export const APP_THEME_STORAGE_KEY = "jami:app-theme";
export const LEGACY_APP_BACKGROUND_STORAGE_KEY = "jami:app-background";
export const APP_THEME_EVENT = "jami-app-theme-change";

export type AppThemePreference =
  | "normal"
  | "purple"
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
    value: "purple",
    label: "Purple",
    description: "The deep violet Jami look.",
    preview: "linear-gradient(135deg,#160822 0%,#2b1540 50%,#09050f 100%)",
  },
  {
    value: "paper-white",
    label: "White",
    description: "A clean pale study desk.",
    preview: "linear-gradient(135deg,#ffffff 0%,#f5f7fb 54%,#dbe4f2 100%)",
  },
  {
    value: "soft-grey",
    label: "Grey",
    description: "A darker neutral workspace.",
    preview: "linear-gradient(135deg,#2b2b2b 0%,#1d1d1d 54%,#0f0f0f 100%)",
  },
];

function isAppThemePreference(value: unknown): value is AppThemePreference {
  return (
    value === "normal" ||
    value === "purple" ||
    value === "paper-white" ||
    value === "soft-grey"
  );
}

function normalizeAppThemePreference(value: unknown): AppThemePreference | null {
  if (value === "purple-pink") return "purple";
  if (isAppThemePreference(value)) return value;
  return null;
}

export function readAppThemePreference(): AppThemePreference {
  if (typeof window === "undefined") return "normal";

  try {
    const value = localStorage.getItem(APP_THEME_STORAGE_KEY);
    const theme = normalizeAppThemePreference(value);
    if (theme) return theme;

    const legacyValue = localStorage.getItem(LEGACY_APP_BACKGROUND_STORAGE_KEY);
    const legacyTheme = normalizeAppThemePreference(legacyValue);
    if (legacyTheme) return legacyTheme;
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
