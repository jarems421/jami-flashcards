import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getRedirectResult: vi.fn(),
  setPersistence: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
}));

vi.mock("@/services/firebase/client", () => ({
  auth: {},
}));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {},
  getRedirectResult: authMocks.getRedirectResult,
  signInWithPopup: authMocks.signInWithPopup,
  signInWithRedirect: authMocks.signInWithRedirect,
  signOut: vi.fn(),
  deleteUser: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  setPersistence: authMocks.setPersistence,
  browserLocalPersistence: {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRetryableInitializer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The first test pays the cold import of "@/services/auth" (which pulls the
  // whole firebase/firestore package); under parallel suite load that alone
  // can pass five seconds, so give it explicit room.
  it("retries after an initialization failure", async () => {
    let callCount = 0;

    const initialize = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("first init failed");
      }
    });

    const { createRetryableInitializer } = await import("@/services/auth");
    const init = createRetryableInitializer(initialize);

    await expect(init()).rejects.toThrow("first init failed");
    await expect(init()).resolves.toBeUndefined();

    expect(initialize).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("memoizes successful initialization", async () => {
    const initialize = vi.fn(async () => undefined);
    const { createRetryableInitializer } = await import("@/services/auth");
    const init = createRetryableInitializer(initialize);

    await expect(init()).resolves.toBeUndefined();
    await expect(init()).resolves.toBeUndefined();
    await expect(init()).resolves.toBeUndefined();

    expect(initialize).toHaveBeenCalledTimes(1);
  });
});

describe("signInWithGoogle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.setPersistence.mockResolvedValue(undefined);
    authMocks.signInWithRedirect.mockResolvedValue(undefined);
  });

  it("uses popup sign-in in an installed PWA", async () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: true })),
      navigator: { standalone: true },
    });
    const user = { uid: "pwa-user" };
    authMocks.signInWithPopup.mockResolvedValue({ user });

    const { signInWithGoogle } = await import("@/services/auth");

    await expect(signInWithGoogle()).resolves.toBe(user);
    expect(authMocks.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(authMocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it.each([
    { mode: "display mode", displayMode: true, navigatorStandalone: false },
    { mode: "iOS home screen", displayMode: false, navigatorStandalone: true },
  ])(
    "does not send a $mode PWA into the broken redirect fallback",
    async ({ displayMode, navigatorStandalone }) => {
      vi.stubGlobal("window", {
        matchMedia: vi.fn(() => ({ matches: displayMode })),
        navigator: { standalone: navigatorStandalone },
      });
      const popupError = { code: "auth/popup-blocked" };
      authMocks.signInWithPopup.mockRejectedValue(popupError);

      const { signInWithGoogle } = await import("@/services/auth");

      await expect(signInWithGoogle()).rejects.toBe(popupError);
      expect(authMocks.signInWithRedirect).not.toHaveBeenCalled();
    }
  );

  it("retains redirect fallback for a blocked popup in a browser tab", async () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: false })),
      navigator: {},
    });
    authMocks.signInWithPopup.mockRejectedValue({ code: "auth/popup-blocked" });

    const { signInWithGoogle } = await import("@/services/auth");

    await expect(signInWithGoogle()).resolves.toBeNull();
    expect(authMocks.signInWithRedirect).toHaveBeenCalledTimes(1);
  });
});
