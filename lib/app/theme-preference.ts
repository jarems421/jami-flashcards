"use client";

import {
  CONSTELLATION_BACKGROUND_CRASH_MARKER_STORAGE_KEY,
  CONSTELLATION_BACKGROUND_STORAGE_KEY,
} from "@/lib/constellation/background";

export const APP_THEME_STORAGE_KEY = "jami:app-theme";
export const LEGACY_APP_BACKGROUND_STORAGE_KEY = "jami:app-background";
export const APP_THEME_EVENT = "jami-app-theme-change";

export type AppThemePreference =
  | "normal"
  | "purple"
  | "pink"
  | "paper-white"
  | "soft-grey"
  | "black";

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
    value: "pink",
    label: "Pink",
    description: "Soft blush with hot pink accents.",
    preview: "linear-gradient(135deg,#fff5fa 0%,#ffd9ec 52%,#f472b6 100%)",
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
  {
    value: "black",
    label: "Black",
    description: "True black for OLED screens.",
    preview: "linear-gradient(135deg,#0a0a0a 0%,#000000 54%,#000000 100%)",
  },
];

export const APP_THEME_CLASS_NAMES = [
  ...APP_THEME_OPTIONS.map((option) => `app-theme-${option.value}`),
  // A stale class may still be stamped on a document restored from an older
  // Jami session, so cleanup must continue to know about it.
  "app-theme-purple-pink",
  "app-theme-light",
];

export function getActiveAppThemeClassNames(
  value: AppThemePreference
): string[] {
  return [
    `app-theme-${value}`,
    ...(value === "paper-white" || value === "pink"
      ? ["app-theme-light"]
      : []),
  ];
}

function isAppThemePreference(value: unknown): value is AppThemePreference {
  return (
    value === "normal" ||
    value === "purple" ||
    value === "pink" ||
    value === "paper-white" ||
    value === "soft-grey" ||
    value === "black"
  );
}

function normalizeAppThemePreference(value: unknown): AppThemePreference | null {
  // The old purple-pink theme was folded into purple before a distinct pink
  // existed. Keep sending it to purple: anyone still on it chose that look,
  // not the new pink.
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

/**
 * Stamps the stored theme on the document before anything is painted.
 *
 * The theme class is otherwise applied from an effect, which runs after the
 * first paint -- so every single load painted the default navy and swapped to
 * the chosen theme a frame later. On the opening screen that is the whole
 * screen changing colour under the mark, which reads as a second loading
 * screen rather than as one.
 *
 * Built from the same options and class rules the effect uses, so the two
 * cannot drift apart, and wrapped in a try so a browser refusing storage falls
 * through to the default rather than leaving the page blank.
 *
 * It also decides, on the same rule the shell uses, whether the star sky is
 * about to take over the palette -- and stamps the sky's class instead of a
 * theme's when it is. Without that the app opens in the stored theme's colours
 * and swaps to black a frame later, which is the flash this script exists to
 * prevent, just moved.
 */
export const APP_THEME_BOOTSTRAP_SCRIPT = `(function(){try{var c=${JSON.stringify(
  Object.fromEntries(
    APP_THEME_OPTIONS.map((option) => [
      option.value,
      getActiveAppThemeClassNames(option.value),
    ])
  )
)},s=window.localStorage,t=s.getItem(${JSON.stringify(
  APP_THEME_STORAGE_KEY
)})||s.getItem(${JSON.stringify(
  LEGACY_APP_BACKGROUND_STORAGE_KEY
)});if(t==="purple-pink")t="purple";var d=document.documentElement,p=(window.location&&window.location.pathname)||"";if(s.getItem(${JSON.stringify(
  CONSTELLATION_BACKGROUND_STORAGE_KEY
)})==="true"&&s.getItem(${JSON.stringify(
  CONSTELLATION_BACKGROUND_CRASH_MARKER_STORAGE_KEY
)})!=="true"&&p!=="/dashboard/constellation"){d.classList.add("constellation-background-enabled")}else{d.classList.add.apply(d.classList,c[t]||c.normal)}}catch(e){}})();`;

export function saveAppThemePreference(value: AppThemePreference) {
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, value);
    localStorage.removeItem(LEGACY_APP_BACKGROUND_STORAGE_KEY);
  } catch {
    // Non-critical local display preference.
  }

  window.dispatchEvent(new Event(APP_THEME_EVENT));
}
