import { beforeEach, describe, expect, it, vi } from "vitest";

const firestoreMock = vi.hoisted(() => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  query: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn(),
  writeBatch: vi.fn(() => ({
    delete: vi.fn(),
    commit: vi.fn(async () => {}),
  })),
  deleteField: vi.fn(),
}));

vi.mock("firebase/firestore", () => firestoreMock);

vi.mock("@/services/firebase/client", () => ({
  db: {},
}));

vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: vi.fn(async (promise: Promise<unknown>) => await promise),
}));

describe("constellations initial setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses deterministic 'initial' doc id when no constellations exist", async () => {
    const initialRef = { id: "initial" };
    const stateRef = { id: "active" };
    const transactionGet = vi.fn(async () => ({ exists: () => false, data: () => ({}) }));
    const transactionSet = vi.fn();

    firestoreMock.collection.mockReturnValue({});
    firestoreMock.doc.mockImplementation((_db, _users, _userId, path, id) => {
      if (path === "constellations" && id === "initial") {
        return initialRef;
      }

      if (path === "constellationState" && id === "active") {
        return stateRef;
      }

      return { id: id ?? "unknown" };
    });
    firestoreMock.getDocs.mockResolvedValue({ empty: true, docs: [] });
    firestoreMock.runTransaction.mockImplementation(async (_db, fn) =>
      fn({ get: transactionGet, set: transactionSet })
    );
    firestoreMock.getDoc.mockResolvedValue({
      exists: () => true,
      id: "initial",
      data: () => ({
        name: "Constellation 1",
        status: "active",
        maxStars: 40,
        maxDust: 400,
        awardedStarsCount: 0,
        awardedDustCount: 0,
        createdAt: 1,
      }),
    });

    const { getConstellations, INITIAL_CONSTELLATION_ID } = await import(
      "@/services/constellation/constellations"
    );

    await getConstellations("user-1");

    expect(INITIAL_CONSTELLATION_ID).toBe("initial");
    expect(firestoreMock.doc).toHaveBeenCalledWith(
      {},
      "users",
      "user-1",
      "constellations",
      "initial"
    );
    expect(transactionSet).toHaveBeenCalledWith(initialRef, expect.any(Object));
  });

  it("does not create initial doc if transaction finds it already exists", async () => {
    const initialRef = { id: "initial" };
    const stateRef = { id: "active" };
    const transactionGet = vi.fn(async (ref) => {
      if (ref === initialRef) {
        return { exists: () => true, data: () => ({}) };
      }

      return {
        exists: () => true,
        data: () => ({ activeConstellationId: "initial" }),
      };
    });
    const transactionSet = vi.fn();

    firestoreMock.collection.mockReturnValue({});
    firestoreMock.doc.mockImplementation((_db, _users, _userId, path, id) => {
      if (path === "constellations" && id === "initial") {
        return initialRef;
      }

      if (path === "constellationState" && id === "active") {
        return stateRef;
      }

      return { id: id ?? "unknown" };
    });
    firestoreMock.getDocs.mockResolvedValue({ empty: true, docs: [] });
    firestoreMock.runTransaction.mockImplementation(async (_db, fn) =>
      fn({ get: transactionGet, set: transactionSet })
    );
    firestoreMock.getDoc.mockResolvedValue({
      exists: () => true,
      id: "initial",
      data: () => ({
        name: "Constellation 1",
        status: "active",
        maxStars: 40,
        maxDust: 400,
        awardedStarsCount: 0,
        awardedDustCount: 0,
        createdAt: 1,
      }),
    });

    const { getConstellations } = await import(
      "@/services/constellation/constellations"
    );

    await getConstellations("user-2");

    expect(transactionSet).not.toHaveBeenCalledWith(initialRef, expect.any(Object));
  });

  it("repairs accounts with multiple active constellations", async () => {
    const docRefFor = (constellationId: string) => ({ id: constellationId });

    firestoreMock.collection.mockReturnValue({});
    firestoreMock.getDocs
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: "newest-active",
            data: () => ({
              name: "Newest",
              status: "active",
              maxStars: 40,
              maxNebulaProgress: 400,
              starCount: 0,
              nebulaProgressCount: 0,
              createdAt: 300,
            }),
          },
          {
            id: "older-active",
            data: () => ({
              name: "Older",
              status: "active",
              maxStars: 40,
              maxNebulaProgress: 400,
              starCount: 0,
              nebulaProgressCount: 0,
              createdAt: 200,
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ empty: true, docs: [] });
    firestoreMock.doc.mockImplementation((_db, _users, _userId, _path, constellationId) =>
      docRefFor(constellationId)
    );
    firestoreMock.getDoc.mockResolvedValue({
      exists: () => false,
      data: () => ({}),
    });

    const { getConstellations } = await import(
      "@/services/constellation/constellations"
    );
    const repaired = await getConstellations("user-3");

    expect(firestoreMock.updateDoc).toHaveBeenCalledTimes(1);
    expect(firestoreMock.updateDoc).toHaveBeenCalledWith(
      { id: "older-active" },
      expect.objectContaining({ status: "finished" })
    );
    expect(firestoreMock.setDoc).toHaveBeenCalledWith(
      { id: "active" },
      expect.objectContaining({ activeConstellationId: "newest-active" })
    );
    expect(repaired.find((c) => c.id === "newest-active")?.status).toBe("active");
    expect(repaired.find((c) => c.id === "older-active")?.status).toBe("finished");
  });

  it("prevents creating a new constellation when one is already active", async () => {
    const activeStateRef = { id: "active" };
    const activeConstellationRef = { id: "active-1" };

    firestoreMock.collection.mockReturnValue({});
    firestoreMock.getDocs.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: "active-1",
          data: () => ({
            name: "Current",
            status: "active",
            maxStars: 40,
            maxDust: 400,
            createdAt: 100,
          }),
        },
      ],
    });
    firestoreMock.doc.mockImplementation((_db, _users, _userId, path, id) => {
      if (path === "constellationState") {
        return activeStateRef;
      }

      if (path === "constellations" && id === "active-1") {
        return activeConstellationRef;
      }

      return { id: id ?? "new-id" };
    });
    firestoreMock.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ activeConstellationId: "active-1" }),
    });
    firestoreMock.runTransaction.mockImplementation(async (_db, fn) =>
      fn({
        get: async (ref: { id: string }) => {
          if (ref.id === "active") {
            return {
              exists: () => true,
              data: () => ({ activeConstellationId: "active-1" }),
            };
          }

          if (ref.id === "active-1") {
            return {
              exists: () => true,
              data: () => ({ status: "active" }),
            };
          }

          return {
            exists: () => false,
            data: () => ({}),
          };
        },
        set: vi.fn(),
      })
    );

    const { createConstellation } = await import(
      "@/services/constellation/constellations"
    );

    await expect(createConstellation("user-4", "Next")).rejects.toThrow(
      "Finish your active constellation before creating a new one."
    );
    expect(firestoreMock.addDoc).not.toHaveBeenCalled();
  });
});
