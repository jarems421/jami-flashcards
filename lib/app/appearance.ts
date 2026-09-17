import {
  readAppThemePreference,
  saveAppThemePreference,
  APP_THEME_OPTIONS,
  type AppThemePreference,
} from "@/lib/app/theme-preference";
import {
  readConstellationBackgroundConstellationId,
  readConstellationBackgroundEnabled,
  setConstellationBackgroundConstellationId,
  setConstellationBackgroundEnabled,
} from "@/lib/constellation/background";
import { readPanelStyle, savePanelStyle, type PanelStyle } from "@/lib/app/panel-style";
import {
  DEFAULT_APP_FONT,
  isAppFontId,
  readAppFont,
  saveAppFont,
  type AppFontId,
} from "@/lib/app/app-font";

/**
 * How Jami looks, as one account's choice rather than one device's.
 *
 * The colour theme, the star sky and the panel style used to live only on the
 * device. Signing into a second account on the same laptop opened it in the
 * first account's pink, and a brand-new account never saw Jami's own colours.
 * The account now holds the choice. The device keeps a copy, stamped with whose
 * it is, because the blocking script in the head has to paint the first frame
 * before anything can be read from the account.
 *
 * The photo background was already kept this way; see `syncPhotoBackground`.
 */
export type AccountAppearance = {
  theme: AppThemePreference;
  sky: boolean;
  skyConstellationId: string;
  panelStyle: PanelStyle;
  /** The typeface Jami is set in; see `lib/app/app-font.ts`. */
  font: AppFontId;
  updatedAt: number;
};

export type AppearanceChoice = Omit<AccountAppearance, "updatedAt">;

/** Jami's own look: the blue-grey theme, no sky, glass panels. What every new account opens in. */
export const DEFAULT_APPEARANCE: AppearanceChoice = {
  theme: "normal",
  sky: false,
  skyConstellationId: "",
  panelStyle: "glass",
  font: DEFAULT_APP_FONT,
};

export const APPEARANCE_OWNER_STORAGE_KEY = "jami:appearance-owner";

/**
 * Accounts made before appearance moved onto the account.
 *
 * Their look was only ever on the device, so the first one to sign in there
 * keeps it. Anything newer starts from Jami's own look instead of inheriting
 * whatever the device happened to be set to.
 */
export const APPEARANCE_ON_ACCOUNT_SINCE = Date.UTC(2026, 8, 15);

const THEMES = new Set<string>(APP_THEME_OPTIONS.map((option) => option.value));

export function normalizeAccountAppearance(value: unknown): AccountAppearance | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.theme !== "string" || !THEMES.has(data.theme)) return null;
  return {
    theme: data.theme as AppThemePreference,
    sky: data.sky === true,
    skyConstellationId: typeof data.skyConstellationId === "string" ? data.skyConstellationId.slice(0, 160) : "",
    panelStyle: data.panelStyle === "solid" ? "solid" : "glass",
    // Accounts saved before the face was a choice simply have Jami's own.
    font: isAppFontId(data.font) ? data.font : DEFAULT_APP_FONT,
    updatedAt: typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt) ? data.updatedAt : 0,
  };
}

export function readDeviceAppearance(): AppearanceChoice {
  return {
    theme: readAppThemePreference(),
    sky: readConstellationBackgroundEnabled(),
    skyConstellationId: readConstellationBackgroundConstellationId(),
    panelStyle: readPanelStyle(),
    font: readAppFont(),
  };
}

export function readAppearanceOwner(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(APPEARANCE_OWNER_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Paints a choice on this device, touching only what differs so nothing flickers. */
export function applyAppearanceToDevice(choice: AppearanceChoice, ownerId: string | null) {
  if (typeof window === "undefined") return;
  const current = readDeviceAppearance();
  if (current.theme !== choice.theme) saveAppThemePreference(choice.theme);
  if (current.skyConstellationId !== choice.skyConstellationId) {
    setConstellationBackgroundConstellationId(choice.skyConstellationId);
  }
  if (current.sky !== choice.sky) setConstellationBackgroundEnabled(choice.sky);
  if (current.panelStyle !== choice.panelStyle) savePanelStyle(choice.panelStyle);
  if (current.font !== choice.font) saveAppFont(choice.font);
  try {
    if (ownerId) window.localStorage.setItem(APPEARANCE_OWNER_STORAGE_KEY, ownerId);
    else window.localStorage.removeItem(APPEARANCE_OWNER_STORAGE_KEY);
  } catch {
    // The account copy is what counts; the owner stamp only speeds up the next sign-in.
  }
}

/**
 * What a sign-in should show, and whether the device's look should be saved to the account.
 *
 *  - the account has a look: that one;
 *  - it has none, but this device's look is already this account's (a save that
 *    never reached the account): keep it, and save it;
 *  - it has none, the device's look belongs to nobody yet, and the account is
 *    old enough to have chosen it: adopt it, and save it;
 *  - otherwise, Jami's own look.
 */
export function resolveSignInAppearance(input: {
  userId: string;
  remote: AccountAppearance | null;
  device: AppearanceChoice;
  deviceOwner: string | null;
  accountCreatedAt: number;
}): { choice: AppearanceChoice; save: boolean } {
  if (input.remote) {
    const { theme, sky, skyConstellationId, panelStyle, font } = input.remote;
    return { choice: { theme, sky, skyConstellationId, panelStyle, font }, save: false };
  }
  if (input.deviceOwner === input.userId) return { choice: input.device, save: true };
  if (
    input.deviceOwner === null &&
    Number.isFinite(input.accountCreatedAt) &&
    input.accountCreatedAt > 0 &&
    input.accountCreatedAt < APPEARANCE_ON_ACCOUNT_SINCE
  ) {
    return { choice: input.device, save: true };
  }
  return { choice: DEFAULT_APPEARANCE, save: false };
}
