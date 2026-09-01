import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMock = vi.hoisted(() => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getCountFromServer: vi.fn(),
  runTransaction: vi.fn(),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(),
}));

vi.mock("firebase/firestore", () => firestoreMock);
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: vi.fn(async (promise: Promise<unknown>) => await promise),
}));

const getActiveOrCreateInitialConstellation = vi.fn();
vi.mock("@/services/constellation/constellations", () => ({
  getActiveOrCreateInitialConstellation: (...args: unknown[]) =>
    getActiveOrCreateInitialConstellation(...args),
}));

const STAR_ID = "onboarding-first-loop";

type TransactionSnapshot = {
  exists: () => boolean;
  data: () => Record<string, unknown>;
};

function starRefFor() {
  return { id: STAR_ID };
}

function wireRefs() {
  firestoreMock.collection.mockReturnValue({ path: "stars" });
  firestoreMock.doc.mockImplementation((...args: unknown[]) => {
    const last = args.at(-1);
    return { id: typeof last === "string" ? last : "unknown" };
  });
}

async function importService() {
  return await import("@/services/constellation/stars");
}

describe("the first-loop onboarding star", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wireRefs();
  });

  it("creates one star transactionally and counts it toward the constellation", async () => {
    const { createOnboardingStarIfMissing } = await importService();
    getActiveOrCreateInitialConstellation.mockResolvedValue({
      id: "constellation-1",
      starCount: 3,
      maxStars: 12,
    });
    firestoreMock.getDoc.mockResolvedValue({ exists: () => false });

    const transactionSet = vi.fn();
    const transactionUpdate = vi.fn();
    firestoreMock.runTransaction.mockImplementation(async (_db, run) =>
      run({
        get: vi.fn(async (ref: { id: string }): Promise<TransactionSnapshot> =>
          ref.id === STAR_ID
            ? { exists: () => false, data: () => ({}) }
            : {
                exists: () => true,
                data: () => ({ starCount: 3, maxStars: 12 }),
              }
        ),
        set: transactionSet,
        update: transactionUpdate,
      })
    );

    const result = await createOnboardingStarIfMissing("user-1");

    expect(result.status).toBe("awarded");
    expect(transactionSet).toHaveBeenCalledTimes(1);
    expect(transactionUpdate).toHaveBeenCalledWith(expect.anything(), {
      starCount: 4,
    });

    const [, written] = transactionSet.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(written.rewardKind).toBe("onboarding");
    expect(written.rewardLabel).toBe("First study loop");
    // Stars no longer carry a colour: they were white, blue and gold, and the
    // hue sat in the middle of the star rather than in the light around it.
    expect(written.color).toBeUndefined();
    expect(written.constellationId).toBe("constellation-1");
  });

  it("is idempotent: a replay finds the existing star and mints nothing", async () => {
    const { createOnboardingStarIfMissing } = await importService();
    firestoreMock.getDoc.mockResolvedValue({
      exists: () => true,
      id: STAR_ID,
      data: () => ({
        goalId: "",
        constellationId: "constellation-1",
        size: 20,
        glow: 0.85,
        color: "white",
        presetId: "classic",
        rewardKind: "onboarding",
        rewardLabel: "First study loop",
        position: { x: 40, y: 40 },
        createdAt: 1,
      }),
    });

    const result = await createOnboardingStarIfMissing("user-1");

    expect(result.status).toBe("exists");
    expect(firestoreMock.runTransaction).not.toHaveBeenCalled();
    expect(getActiveOrCreateInitialConstellation).not.toHaveBeenCalled();
  });

  it("holds the reward as pending when the constellation is full", async () => {
    const { createOnboardingStarIfMissing } = await importService();
    getActiveOrCreateInitialConstellation.mockResolvedValue({
      id: "constellation-1",
      starCount: 12,
      maxStars: 12,
    });
    firestoreMock.getDoc.mockResolvedValue({ exists: () => false });

    const result = await createOnboardingStarIfMissing("user-1");

    expect(result.status).toBe("pending");
    expect(firestoreMock.runTransaction).not.toHaveBeenCalled();
  });

  it("holds the reward as pending when there is no constellation at all", async () => {
    const { createOnboardingStarIfMissing } = await importService();
    getActiveOrCreateInitialConstellation.mockResolvedValue(null);
    firestoreMock.getDoc.mockResolvedValue({ exists: () => false });

    expect((await createOnboardingStarIfMissing("user-1")).status).toBe(
      "pending"
    );
  });

  it("re-reads rather than guessing when the transaction declines to write", async () => {
    const { createOnboardingStarIfMissing } = await importService();
    getActiveOrCreateInitialConstellation.mockResolvedValue({
      id: "constellation-1",
      starCount: 3,
      maxStars: 12,
    });

    // A second device won the race: absent on the first read, present after.
    firestoreMock.getDoc
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({
        exists: () => true,
        id: STAR_ID,
        data: () => ({
          goalId: "",
          constellationId: "constellation-1",
          size: 20,
          glow: 0.85,
          color: "white",
          presetId: "classic",
          rewardKind: "onboarding",
          position: { x: 40, y: 40 },
          createdAt: 1,
        }),
      });
    firestoreMock.runTransaction.mockImplementation(async (_db, run) =>
      run({
        get: vi.fn(async (ref: { id: string }): Promise<TransactionSnapshot> =>
          ref.id === STAR_ID
            ? { exists: () => true, data: () => ({}) }
            : {
                exists: () => true,
                data: () => ({ starCount: 3, maxStars: 12 }),
              }
        ),
        set: vi.fn(),
        update: vi.fn(),
      })
    );

    const result = await createOnboardingStarIfMissing("user-1");

    expect(result.status).toBe("exists");
    expect(starRefFor().id).toBe(STAR_ID);
  });

  it("stops if the constellation filled up between the check and the write", async () => {
    const { createOnboardingStarIfMissing } = await importService();
    getActiveOrCreateInitialConstellation.mockResolvedValue({
      id: "constellation-1",
      starCount: 11,
      maxStars: 12,
    });
    firestoreMock.getDoc.mockResolvedValue({ exists: () => false });

    const transactionSet = vi.fn();
    firestoreMock.runTransaction.mockImplementation(async (_db, run) =>
      run({
        get: vi.fn(async (ref: { id: string }): Promise<TransactionSnapshot> =>
          ref.id === STAR_ID
            ? { exists: () => false, data: () => ({}) }
            : {
                exists: () => true,
                data: () => ({ starCount: 12, maxStars: 12 }),
              }
        ),
        set: transactionSet,
        update: vi.fn(),
      })
    );

    expect((await createOnboardingStarIfMissing("user-1")).status).toBe(
      "pending"
    );
    expect(transactionSet).not.toHaveBeenCalled();
  });
});
