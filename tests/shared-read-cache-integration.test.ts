import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The behaviour the plan exists for: six pages asking for the same data issue
 * one read, a write is seen, and anything that feeds a write still reads from
 * the server.
 *
 * This drives the real service functions against a counting Firestore stub, so
 * it fails if a service stops going through the shared cache — which asserting
 * on the cache module directly would not catch.
 */

let reads = 0;

vi.mock("firebase/firestore", () => {
  const passthrough = (...args: unknown[]) => ({ args });
  return {
    collection: passthrough,
    query: passthrough,
    where: passthrough,
    orderBy: passthrough,
    limit: passthrough,
    documentId: passthrough,
    startAfter: passthrough,
    doc: passthrough,
    getDoc: async () => ({ exists: () => false }),
    getDocs: async () => {
      reads += 1;
      return { docs: [] };
    },
    addDoc: async () => ({ id: "new" }),
    updateDoc: async () => undefined,
    deleteDoc: async () => undefined,
    writeBatch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => {} }),
  };
});
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/firebase/firestore", () => ({
  withTimeout: <T,>(promise: Promise<T>) => promise,
  isFirebasePermissionDenied: () => false,
}));

const { getDecks } = await import("@/services/study/decks");
const { loadUserCards } = await import("@/services/study/cards");
const { getActiveTopics } = await import("@/services/study/topics");
const { invalidateDashboardData, clearDashboardData } = await import(
  "@/services/dashboard/cache"
);
const { resetCachedReadsForTests } = await import(
  "@/services/cache/read-through"
);

beforeEach(() => {
  reads = 0;
  resetCachedReadsForTests();
});

describe("reads shared across pages", () => {
  it("issues one read however many pages ask for the decks", async () => {
    await getDecks("student");
    const afterFirst = reads;

    // Decks, Today, Study, Progress, Cards and Library all want this.
    await Promise.all([
      getDecks("student"),
      getDecks("student"),
      getDecks("student"),
      getDecks("student"),
      getDecks("student"),
    ]);

    expect(reads).toBe(afterFirst);
  });

  it("issues one read for the cards every page wants", async () => {
    await loadUserCards("student");
    const afterFirst = reads;

    await Promise.all([loadUserCards("student"), loadUserCards("student")]);

    expect(reads).toBe(afterFirst);
  });

  it("issues one read for the topics every page wants", async () => {
    await getActiveTopics("student");
    const afterFirst = reads;

    await getActiveTopics("student");

    expect(reads).toBe(afterFirst);
  });
});

describe("a write is seen", () => {
  it("re-reads after a domain write invalidates", async () => {
    await getDecks("student");
    const afterFirst = reads;

    invalidateDashboardData("student");
    await getDecks("student");

    expect(reads).toBeGreaterThan(afterFirst);
  });

  it("does not disturb another student's cached reads", async () => {
    await getDecks("one");
    await getDecks("two");
    const afterBoth = reads;

    invalidateDashboardData("one");
    await getDecks("two");

    expect(reads).toBe(afterBoth);
  });

  it("drops everything on sign-out", async () => {
    await getDecks("student");
    const afterFirst = reads;

    clearDashboardData("student");
    await getDecks("student");

    expect(reads).toBeGreaterThan(afterFirst);
  });
});

/**
 * A cache the page cannot see makes "Refresh" ambiguous. Pressing it has to
 * reach the server, or the button appears to do nothing -- which is worse than
 * the wait it was saving.
 */
describe("an explicit refresh", () => {
  it("reaches the server even when the cache is fresh", async () => {
    await getDecks("student");
    const afterFirst = reads;

    await getDecks("student", { force: true });

    expect(reads).toBeGreaterThan(afterFirst);
  });
});

describe("reads that feed a write", () => {
  /**
   * Grading a card computes its next interval from the state it reads. This is
   * the rule that keeps the cache a cache rather than a way to lose work.
   */
  it("goes back to the server when forced, however fresh the cache", async () => {
    await loadUserCards("student");
    const afterFirst = reads;

    await loadUserCards("student", { force: true });

    expect(reads).toBeGreaterThan(afterFirst);
  });

  it("leaves the cache usable for everyone else afterwards", async () => {
    await loadUserCards("student", { force: true });
    const afterForced = reads;

    await loadUserCards("student");

    expect(reads).toBe(afterForced);
  });
});
