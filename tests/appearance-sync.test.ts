import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bringing a device into line with the account that just signed in.
 *
 * A device can carry another account's look. Clearing it must not make the
 * device look unclaimed, or an older account with nothing saved would adopt
 * Jami's default and save it over the look on its own devices.
 */

const mocks = vi.hoisted(() => {
  const device = { owner: null as string | null, choice: {} as Record<string, unknown> };
  return {
    device,
    applyAppearanceToDevice: vi.fn((choice: Record<string, unknown>, owner: string | null) => {
      device.choice = choice;
      device.owner = owner;
    }),
    setDoc: vi.fn(async (...args: unknown[]) => {
      void args;
    }),
  };
});

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  setDoc: mocks.setDoc,
}));
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/lib/app/appearance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app/appearance")>();
  return {
    ...actual,
    applyAppearanceToDevice: mocks.applyAppearanceToDevice,
    readAppearanceOwner: () => mocks.device.owner,
    readDeviceAppearance: () => mocks.device.choice,
  };
});

const { DEFAULT_APPEARANCE } = await import("@/lib/app/appearance");
const { syncAppearance } = await import("@/services/profile/appearance");

/** Created long before appearance was saved on accounts. */
const OLDER_ACCOUNT = 1;
const CUSTOM_LOOK = { ...DEFAULT_APPEARANCE, theme: "custom-look" };

beforeEach(() => {
  mocks.applyAppearanceToDevice.mockClear();
  mocks.setDoc.mockClear();
});

describe("syncing appearance on sign-in", () => {
  it("never saves the default look to an older account signing in on someone else's device", async () => {
    mocks.device.owner = "someone-else";
    mocks.device.choice = CUSTOM_LOOK;

    await syncAppearance("user-1", OLDER_ACCOUNT);

    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(mocks.device).toEqual({ owner: "user-1", choice: DEFAULT_APPEARANCE });
  });

  it("keeps and saves the look on an older account's own unclaimed device", async () => {
    mocks.device.owner = null;
    mocks.device.choice = CUSTOM_LOOK;

    await syncAppearance("user-1", OLDER_ACCOUNT);

    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    expect(mocks.setDoc.mock.calls[0]?.[1]).toMatchObject({ appearance: { theme: "custom-look" } });
    expect(mocks.device).toEqual({ owner: "user-1", choice: CUSTOM_LOOK });
  });
});
