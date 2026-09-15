// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  APPEARANCE_ON_ACCOUNT_SINCE,
  APPEARANCE_OWNER_STORAGE_KEY,
  applyAppearanceToDevice,
  DEFAULT_APPEARANCE,
  normalizeAccountAppearance,
  readDeviceAppearance,
  resolveSignInAppearance,
} from "@/lib/app/appearance";
import { APP_THEME_STORAGE_KEY } from "@/lib/app/theme-preference";
import { CONSTELLATION_BACKGROUND_STORAGE_KEY } from "@/lib/constellation/background";

const PINK = { theme: "pink" as const, sky: false, skyConstellationId: "", panelStyle: "glass" as const };
const OLD_ACCOUNT = APPEARANCE_ON_ACCOUNT_SINCE - 30 * 24 * 60 * 60 * 1000;
const NEW_ACCOUNT = APPEARANCE_ON_ACCOUNT_SINCE + 60 * 1000;

beforeEach(() => {
  localStorage.clear();
});

describe("reading an account's look", () => {
  it("keeps what it recognises and refuses what it does not", () => {
    expect(normalizeAccountAppearance({ theme: "pink", sky: true, skyConstellationId: "c1", panelStyle: "solid", updatedAt: 5 })).toEqual({
      theme: "pink",
      sky: true,
      skyConstellationId: "c1",
      panelStyle: "solid",
      updatedAt: 5,
    });
    expect(normalizeAccountAppearance({ theme: "neon" })).toBeNull();
    expect(normalizeAccountAppearance(null)).toBeNull();
  });
});

describe("what a sign-in shows", () => {
  it("shows the account's own look wherever it signs in", () => {
    expect(
      resolveSignInAppearance({
        userId: "a",
        remote: { ...PINK, updatedAt: 1 },
        device: DEFAULT_APPEARANCE,
        deviceOwner: "b",
        accountCreatedAt: NEW_ACCOUNT,
      })
    ).toEqual({ choice: PINK, save: false });
  });

  it("opens a new account in Jami's own look, not the last account's", () => {
    // The bug: a second account on the same laptop opened in the first one's pink.
    expect(
      resolveSignInAppearance({ userId: "new", remote: null, device: PINK, deviceOwner: "old", accountCreatedAt: NEW_ACCOUNT })
    ).toEqual({ choice: DEFAULT_APPEARANCE, save: false });
    // Even when the device's look was never stamped with an owner.
    expect(
      resolveSignInAppearance({ userId: "new", remote: null, device: PINK, deviceOwner: null, accountCreatedAt: NEW_ACCOUNT })
    ).toEqual({ choice: DEFAULT_APPEARANCE, save: false });
  });

  it("lets an account from before this keep the look its device already had, and saves it", () => {
    expect(
      resolveSignInAppearance({ userId: "old", remote: null, device: PINK, deviceOwner: null, accountCreatedAt: OLD_ACCOUNT })
    ).toEqual({ choice: PINK, save: true });
    // But not a look another account has already claimed.
    expect(
      resolveSignInAppearance({ userId: "old", remote: null, device: PINK, deviceOwner: "someone", accountCreatedAt: OLD_ACCOUNT })
    ).toEqual({ choice: DEFAULT_APPEARANCE, save: false });
  });

  it("catches the account up with a choice this device made that never reached it", () => {
    expect(
      resolveSignInAppearance({ userId: "a", remote: null, device: PINK, deviceOwner: "a", accountCreatedAt: NEW_ACCOUNT })
    ).toEqual({ choice: PINK, save: true });
  });
});

describe("painting it on the device", () => {
  it("writes the choice where the blocking script reads it, stamped with its owner", () => {
    applyAppearanceToDevice({ theme: "pink", sky: true, skyConstellationId: "c1", panelStyle: "solid" }, "a");
    expect(localStorage.getItem(APP_THEME_STORAGE_KEY)).toBe("pink");
    expect(localStorage.getItem(CONSTELLATION_BACKGROUND_STORAGE_KEY)).toBe("true");
    expect(localStorage.getItem(APPEARANCE_OWNER_STORAGE_KEY)).toBe("a");
    expect(readDeviceAppearance()).toEqual({ theme: "pink", sky: true, skyConstellationId: "c1", panelStyle: "solid" });
  });

  it("goes back to Jami's own look, owned by nobody, on sign-out", () => {
    applyAppearanceToDevice(PINK, "a");
    applyAppearanceToDevice(DEFAULT_APPEARANCE, null);
    expect(readDeviceAppearance()).toEqual(DEFAULT_APPEARANCE);
    expect(localStorage.getItem(APPEARANCE_OWNER_STORAGE_KEY)).toBeNull();
  });
});
