import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * When confirmation started to count, and who that leaves out. The module
 * keeps per-instance caches, so each test loads a fresh copy.
 */
const mocks = vi.hoisted(() => {
  const settings = new Map<string, Record<string, unknown>>();
  const ref = { path: "serverSettings/emailConfirmation" };
  return {
    settings,
    getUser: vi.fn(),
    db: {
      collection: () => ({
        doc: () => ({
          ...ref,
          get: async () => ({ data: () => settings.get(ref.path) }),
        }),
      }),
      runTransaction: async <T>(
        run: (transaction: {
          get: (target: typeof ref) => Promise<{ data: () => Record<string, unknown> | undefined }>;
          set: (target: typeof ref, value: Record<string, unknown>) => void;
        }) => Promise<T>
      ) =>
        run({
          get: async (target) => ({ data: () => settings.get(target.path) }),
          set: (target, value) => settings.set(target.path, value),
        }),
    },
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ getUser: mocks.getUser }),
  getAdminDb: () => mocks.db,
}));

const LIVE = Date.UTC(2026, 8, 26, 12);
const DAY = 86_400_000;

function account(createdAt: number, overrides: Record<string, unknown> = {}) {
  return {
    email: "sam@example.com",
    emailVerified: false,
    providerData: [{ providerId: "password" }],
    metadata: { creationTime: new Date(createdAt).toUTCString() },
    ...overrides,
  };
}

async function load() {
  vi.resetModules();
  return import("@/services/auth/email-confirmation.server");
}

beforeEach(() => {
  mocks.settings.clear();
  mocks.getUser.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("email confirmation for AI", () => {
  it("stamps the start time from the first production request, once", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.getUser.mockResolvedValue(account(LIVE - DAY));
    const { emailAllowsAi } = await load();

    await expect(emailAllowsAi("existing-student", LIVE)).resolves.toBe(true);
    expect(mocks.settings.get("serverSettings/emailConfirmation")).toEqual({
      requiredFrom: LIVE,
    });

    // A later instance finds the stamp rather than moving it.
    const fresh = await load();
    await fresh.emailAllowsAi("someone-else", LIVE + 5 * DAY);
    expect(mocks.settings.get("serverSettings/emailConfirmation")).toEqual({
      requiredFrom: LIVE,
    });
  });

  it("keeps AI for an existing student who never confirmed", async () => {
    mocks.settings.set("serverSettings/emailConfirmation", { requiredFrom: LIVE });
    mocks.getUser.mockResolvedValue(account(LIVE - 200 * DAY));
    const { emailAllowsAi } = await load();
    await expect(emailAllowsAi("existing-student", LIVE + DAY)).resolves.toBe(true);
  });

  it("refuses an unconfirmed account made after the start, which only the form's bypass can make", async () => {
    mocks.settings.set("serverSettings/emailConfirmation", { requiredFrom: LIVE });
    mocks.getUser.mockResolvedValue(account(LIVE + DAY));
    const { emailAllowsAi } = await load();
    await expect(emailAllowsAi("throwaway", LIVE + 2 * DAY)).resolves.toBe(false);
  });

  it("allows an account made through the new sign-up, which arrives confirmed", async () => {
    mocks.settings.set("serverSettings/emailConfirmation", { requiredFrom: LIVE });
    mocks.getUser.mockResolvedValue(account(LIVE + DAY, { emailVerified: true }));
    const { emailAllowsAi } = await load();
    await expect(emailAllowsAi("new-student", LIVE + 2 * DAY)).resolves.toBe(true);
  });

  it("never starts the clock outside production, and refuses nobody until it has", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    mocks.getUser.mockResolvedValue(account(LIVE + DAY));
    const { emailAllowsAi } = await load();
    await expect(emailAllowsAi("anyone", LIVE + 2 * DAY)).resolves.toBe(true);
    expect(mocks.settings.size).toBe(0);
  });

  it("remembers an allowed account instead of asking Firebase every time", async () => {
    mocks.getUser.mockResolvedValue(account(LIVE - DAY));
    const { emailAllowsAi } = await load();
    await emailAllowsAi("student", LIVE);
    await emailAllowsAi("student", LIVE + 1_000);
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });
});
