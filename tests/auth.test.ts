import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/firebase/client", () => ({
  auth: {},
}));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {},
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  setPersistence: vi.fn(),
  browserLocalPersistence: {},
}));

describe("createRetryableInitializer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
  });

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
