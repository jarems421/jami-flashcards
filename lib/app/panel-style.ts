/**
 * How panels sit over a photo or star-sky background: see-through, so the
 * background shows through cards and menus, or solid.
 *
 * A device preference like the colour theme, kept in local storage so the
 * blocking script in the head can stamp it before the first paint.
 */

export const PANEL_STYLE_STORAGE_KEY = "jami:panel-style";
export const PANEL_STYLE_EVENT = "jami-panel-style-change";
export const SOLID_PANELS_CLASS_NAME = "panels-solid";

export type PanelStyle = "glass" | "solid";

export function readPanelStyle(): PanelStyle {
  if (typeof window === "undefined") return "glass";
  try {
    return window.localStorage.getItem(PANEL_STYLE_STORAGE_KEY) === "solid"
      ? "solid"
      : "glass";
  } catch {
    return "glass";
  }
}

export function savePanelStyle(value: PanelStyle) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PANEL_STYLE_STORAGE_KEY, value);
  } catch {
    // Non-critical local display preference.
  }
  window.dispatchEvent(new Event(PANEL_STYLE_EVENT));
}
