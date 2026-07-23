import {
  getObjectColorPreset,
  normalizeObjectColor,
  normalizeObjectIcon,
  type ObjectColorId,
  type ObjectIconId,
} from "@/lib/workspace/object-card-styles";

export type DeckColorPresetId = ObjectColorId;
export type DeckIconPresetId = ObjectIconId;

export const DECK_STYLE_VERSION = "object-v1";
export const DEFAULT_DECK_COLOR_PRESET: DeckColorPresetId = "sky";
export const DEFAULT_DECK_ICON_PRESET: DeckIconPresetId = "none";

export function normalizeDeckColorPreset(value?: string | null): DeckColorPresetId {
  return normalizeObjectColor(value);
}

export function normalizeDeckIconPreset(value?: string | null): DeckIconPresetId {
  return normalizeObjectIcon(value);
}

export function getDeckColorPreset(id?: string | null) {
  return getObjectColorPreset(id);
}
