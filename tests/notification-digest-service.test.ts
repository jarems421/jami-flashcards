import { describe, expect, it, vi } from "vitest";
import {
  DIGEST_CLAIM_TTL_MS,
  DIGEST_PAGE_SIZE,
  runNotificationDigest,
} from "@/services/notifications/digest";

type StoredDocument = Record<string, unknown>;

type UserFixture = {
  preferences: StoredDocument;
  cards?: StoredDocument[];
  goals?: StoredDocument[];
  subscriptions?: StoredDocument[];
  failCardRead?: boolean;
};

function createFakeDigestDb(fixtures: Record<string, UserFixture>) {
  const documents = new Map<string, StoredDocument>();
  const deletedSubscriptions: string[] = [];
  let queryGetCount = 0;
  let transactionTail = Promise.resolve();
  let onCardRead: (() => Promise<void>) | null = null;

  Object.entries(fixtures).forEach(([userId, fixture]) => {
    documents.set(
      `users/${userId}/notificationPreferences/config`,
      fixture.preferences
    );
    fixture.subscriptions?.forEach((subscription, index) => {
      documents.set(
        `users/${userId}/pushSubscriptions/sub-${index + 1}`,
        subscription
      );
    });
  });

  const makeRef = (path: string) => ({
    path,
    delete: async () => {
      deletedSubscriptions.push(path);
      documents.delete(path);
    },
  });

  const makeDoc = (path: string, id: string, data: StoredDocument) => ({
    id,
    ref: makeRef(path),
    data: () => data,
  });

  const preferenceDocs = () =>
    [...documents.entries()]
      .filter(
        ([path, data]) =>
          path.includes("/notificationPreferences/") && data.enabled === true
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, data]) => makeDoc(path, "config", data));

  const db = {
    collectionGroup: (name: string) => {
      if (name !== "notificationPreferences") {
        throw new Error(`Unexpected collection group: ${name}`);
      }

      const buildQuery = (limitCount = DIGEST_PAGE_SIZE, cursorPath = "") => ({
        where: () => buildQuery(limitCount, cursorPath),
        limit: (nextLimit: number) => buildQuery(nextLimit, cursorPath),
        startAfter: (cursor: { ref: { path: string } }) =>
          buildQuery(limitCount, cursor.ref.path),
        get: async () => {
          queryGetCount += 1;
          const allDocs = preferenceDocs();
          const startIndex = cursorPath
            ? allDocs.findIndex((doc) => doc.ref.path === cursorPath) + 1
            : 0;
          const docs = allDocs.slice(Math.max(0, startIndex), startIndex + limitCount);
          return { docs, empty: docs.length === 0 };
        },
      });

      return buildQuery();
    },
    collection: (name: string) => {
      if (name === "cards") {
        let selectedUser = "";
        const query = {
          where: (_field: string, _operator: string, value: string) => {
            selectedUser = value;
            return query;
          },
          get: async () => {
            await onCardRead?.();
            const fixture = fixtures[selectedUser];
            if (fixture?.failCardRead) throw new Error("Card read failed");
            const docs = (fixture?.cards ?? []).map((data, index) =>
              makeDoc(`cards/card-${index + 1}`, `card-${index + 1}`, data)
            );
            return { docs, empty: docs.length === 0 };
          },
        };
        return query;
      }

      if (name !== "users") throw new Error(`Unexpected collection: ${name}`);
      return {
        doc: (userId: string) => ({
          collection: (collectionName: string) => {
            if (collectionName === "goals") {
              type GoalFilter = {
                field: string;
                operator: string;
                value: unknown;
              };
              const matchingGoals = (
                filters: readonly GoalFilter[],
                maximum: number
              ) =>
                (fixtures[userId]?.goals ?? [])
                  .filter((goal) =>
                    filters.every(({ field, operator, value }) => {
                      const candidate = goal[field];
                      if (operator === "==") return candidate === value;
                      if (operator === ">") {
                        return (
                          typeof candidate === "number" &&
                          typeof value === "number" &&
                          candidate > value
                        );
                      }
                      if (operator === "<=") {
                        return (
                          typeof candidate === "number" &&
                          typeof value === "number" &&
                          candidate <= value
                        );
                      }
                      return false;
                    })
                  )
                  .slice(0, maximum);
              // Firestore query builders are immutable: every `where`/`limit`
              // returns a new query. Sharing one mutable filter list would let
              // the parallel active and legacy-compatibility reads contaminate
              // each other, hiding the exact regression these tests guard.
              const buildQuery = (
                filters: readonly GoalFilter[],
                maximum: number
              ) => ({
                where: (field: string, operator: string, value: unknown) =>
                  buildQuery([...filters, { field, operator, value }], maximum),
                limit: (value: number) => buildQuery(filters, value),
                get: async () => ({
                  docs: matchingGoals(filters, maximum).map((goal, index) =>
                    makeDoc(
                      `users/${userId}/goals/goal-${index + 1}`,
                      `goal-${index + 1}`,
                      goal
                    )
                  ),
                }),
                count: () => ({
                  get: async () => ({
                    data: () => ({
                      count: matchingGoals(filters, maximum).length,
                    }),
                  }),
                }),
              });
              return buildQuery([], Number.POSITIVE_INFINITY);
            }

            if (collectionName === "pushSubscriptions") {
              return {
                get: async () => {
                  const prefix = `users/${userId}/pushSubscriptions/`;
                  const docs = [...documents.entries()]
                    .filter(([path]) => path.startsWith(prefix))
                    .map(([path, data]) =>
                      makeDoc(path, path.slice(prefix.length), data)
                    );
                  return { docs, empty: docs.length === 0 };
                },
              };
            }

            throw new Error(`Unexpected user collection: ${collectionName}`);
          },
        }),
      };
    },
    runTransaction: async <T>(
      run: (transaction: {
        get: (ref: { path: string }) => Promise<{
          data: () => StoredDocument | undefined;
        }>;
        set: (
          ref: { path: string },
          value: StoredDocument,
          options?: { merge?: boolean }
        ) => void;
      }) => Promise<T>
    ) => {
      let release!: () => void;
      const prior = transactionTail;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prior;
      try {
        return await run({
          get: async (ref) => ({ data: () => documents.get(ref.path) }),
          set: (ref, value) => {
            documents.set(ref.path, {
              ...documents.get(ref.path),
              ...value,
            });
          },
        });
      } finally {
        release();
      }
    },
  };

  return {
    db,
    deletedSubscriptions,
    documents,
    get queryGetCount() {
      return queryGetCount;
    },
    setOnCardRead(callback: (() => Promise<void>) | null) {
      onCardRead = callback;
    },
  };
}

function preferences(overrides: StoredDocument = {}) {
  return { enabled: true, mode: "always", updatedAt: 1, ...overrides };
}

function subscription() {
  return {
    endpoint: "https://push.test/device",
    expirationTime: null,
    keys: { auth: "auth", p256dh: "p256dh" },
  };
}

const now = new Date("2026-07-01T15:05:00.000Z").getTime();
const studyDayKey = "2026-07-01";

function run(
  fake: ReturnType<typeof createFakeDigestDb>,
  sendPush = vi.fn(async () => undefined),
  overrides: Record<string, unknown> = {}
) {
  let claimSequence = 0;
  return runNotificationDigest(
    { now, studyDayKey, ...(overrides.input as object) },
    {
      adminDb: fake.db as never,
      clock: () => now + 1_000,
      createClaimId: () => `claim-${(claimSequence += 1)}`,
      logger: {
        error: vi.fn(),
        warn: vi.fn(),
      },
      sendPush,
      ...(overrides.dependencies as object),
    }
  );
}

describe("notification digest orchestration", () => {
  it("reads enabled preferences in pages of 100", async () => {
    const fixtures = Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [
        `user-${String(index).padStart(3, "0")}`,
        { preferences: preferences() },
      ])
    );
    const fake = createFakeDigestDb(fixtures);

    const summary = await run(fake);

    expect(summary).toMatchObject({ considered: 205, skipped: 205, failed: 0 });
    expect(fake.queryGetCount).toBe(3);
  });

  it("never processes more than five users concurrently", async () => {
    const fixtures = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `user-${index}`,
        { preferences: preferences() },
      ])
    );
    const fake = createFakeDigestDb(fixtures);
    let active = 0;
    let maximum = 0;
    fake.setOnCardRead(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
    });

    await run(fake);

    expect(maximum).toBe(5);
  });

  it("claims duplicate invocations so a device is notified once", async () => {
    const fake = createFakeDigestDb({
      "user-1": {
        preferences: preferences(),
        subscriptions: [subscription()],
      },
    });
    const sendPush = vi.fn(async () => undefined);

    const [first, second] = await Promise.all([
      run(fake, sendPush),
      run(fake, sendPush),
    ]);

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(first.sent + second.sent).toBe(1);
    expect(first.skipped + second.skipped).toBe(1);
  });

  it("includes urgent legacy goals whose status field is missing", async () => {
    const fake = createFakeDigestDb({
      "user-1": {
        preferences: preferences(),
        goals: [{ deadline: now + 1_000 }],
        subscriptions: [subscription()],
      },
    });
    const sendPush = vi.fn(async () => undefined);

    await expect(run(fake, sendPush)).resolves.toMatchObject({ sent: 1 });
    expect(sendPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: expect.stringContaining("1 urgent goal") })
    );
  });

  it("does not claim or send after preferences are disabled mid-run", async () => {
    const fake = createFakeDigestDb({
      "user-1": {
        preferences: preferences(),
        subscriptions: [subscription()],
      },
    });
    fake.setOnCardRead(async () => {
      const path = "users/user-1/notificationPreferences/config";
      fake.documents.set(path, {
        ...fake.documents.get(path),
        enabled: false,
      });
    });
    const sendPush = vi.fn(async () => undefined);

    await expect(run(fake, sendPush)).resolves.toMatchObject({
      sent: 0,
      skipped: 1,
    });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("skips a fresh claim and recovers an expired claim", async () => {
    const fresh = createFakeDigestDb({
      "user-1": {
        preferences: preferences({
          digestClaimStudyDayKey: studyDayKey,
          digestClaimId: "other-run",
          digestClaimedAt: now - 1_000,
        }),
        subscriptions: [subscription()],
      },
    });
    const freshSend = vi.fn(async () => undefined);

    await expect(run(fresh, freshSend)).resolves.toMatchObject({
      sent: 0,
      skipped: 1,
    });
    expect(freshSend).not.toHaveBeenCalled();

    const expired = createFakeDigestDb({
      "user-1": {
        preferences: preferences({
          digestClaimStudyDayKey: studyDayKey,
          digestClaimId: "abandoned-run",
          digestClaimedAt: now - DIGEST_CLAIM_TTL_MS,
        }),
        subscriptions: [subscription()],
      },
    });
    const expiredSend = vi.fn(async () => undefined);

    await expect(run(expired, expiredSend)).resolves.toMatchObject({ sent: 1 });
    expect(expiredSend).toHaveBeenCalledOnce();
  });

  it("releases an unsent claim so a transient delivery can retry", async () => {
    const fake = createFakeDigestDb({
      "user-1": {
        preferences: preferences(),
        subscriptions: [subscription()],
      },
    });
    const failedSend = vi.fn(async () => {
      throw new Error("Push provider unavailable");
    });

    await expect(run(fake, failedSend)).resolves.toMatchObject({
      sent: 0,
      failed: 1,
      partial: true,
    });
    expect(
      fake.documents.get("users/user-1/notificationPreferences/config")
    ).toMatchObject({ digestClaimId: null, lastDigestStudyDayKey: null });

    const successfulSend = vi.fn(async () => undefined);
    await expect(run(fake, successfulSend)).resolves.toMatchObject({
      sent: 1,
      failed: 0,
    });
  });

  it("deletes expired subscriptions without treating them as a user failure", async () => {
    const fake = createFakeDigestDb({
      "user-1": {
        preferences: preferences(),
        subscriptions: [subscription()],
      },
    });
    const sendPush = vi.fn(async () => {
      throw { statusCode: 410 };
    });

    const summary = await run(fake, sendPush);

    expect(summary).toMatchObject({
      sent: 0,
      removed: 1,
      skipped: 1,
      failed: 0,
      partial: false,
    });
    expect(fake.deletedSubscriptions).toHaveLength(1);
  });

  it("isolates one user's data failure from the remaining users", async () => {
    const fake = createFakeDigestDb({
      "user-broken": {
        preferences: preferences(),
        subscriptions: [subscription()],
        failCardRead: true,
      },
      "user-healthy": {
        preferences: preferences(),
        subscriptions: [subscription()],
      },
    });
    const sendPush = vi.fn(async () => undefined);

    const summary = await run(fake, sendPush);

    expect(summary).toMatchObject({
      considered: 2,
      sent: 1,
      failed: 1,
      partial: true,
    });
  });

  it("emits one structured warning near the route duration budget", async () => {
    const fake = createFakeDigestDb({
      "user-1": { preferences: preferences() },
      "user-2": { preferences: preferences() },
    });
    const logger = { error: vi.fn(), warn: vi.fn() };
    const clockValues = [now, now + 11, now + 12];

    await runNotificationDigest(
      { now, studyDayKey, durationWarningMs: 10 },
      {
        adminDb: fake.db as never,
        clock: () => clockValues.shift() ?? now + 12,
        createClaimId: () => "claim",
        logger,
        sendPush: vi.fn(async () => undefined),
      }
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "run.approaching_duration_budget",
      expect.objectContaining({ durationWarningMs: 10 })
    );
  });
});
