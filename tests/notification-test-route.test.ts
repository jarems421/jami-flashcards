import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const subscriptions = new Map<string, Record<string, unknown>>();
  const deleted: string[] = [];
  const requestedPaths: string[] = [];

  const makeDoc = (path: string, id: string, data?: Record<string, unknown>) => ({
    id,
    exists: Boolean(data),
    data: () => data,
    ref: {
      path,
      delete: async () => {
        deleted.push(path);
        subscriptions.delete(id);
      },
    },
  });

  const collection = {
    doc: (id: string) => ({
      get: async () => {
        const path = `users/user-1/pushSubscriptions/${id}`;
        requestedPaths.push(path);
        return makeDoc(path, id, subscriptions.get(id));
      },
    }),
    get: async () => {
      requestedPaths.push("users/user-1/pushSubscriptions");
      const docs = [...subscriptions.entries()].map(([id, data]) =>
        makeDoc(`users/user-1/pushSubscriptions/${id}`, id, data)
      );
      return { docs, empty: docs.length === 0 };
    },
  };

  return {
    subscriptions,
    deleted,
    requestedPaths,
    verifyIdToken: vi.fn(),
    sendPush: vi.fn(),
    db: {
      collection: (name: string) => {
        if (name !== "users") throw new Error(`Unexpected collection ${name}`);
        return {
          doc: (uid: string) => {
            if (uid !== "user-1") throw new Error(`Unexpected uid ${uid}`);
            return {
              collection: (child: string) => {
                if (child !== "pushSubscriptions") {
                  throw new Error(`Unexpected child ${child}`);
                }
                return collection;
              },
            };
          },
        };
      },
    },
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
  getAdminDb: () => mocks.db,
}));

vi.mock("@/services/notifications/web-push", () => ({
  sendPushNotification: mocks.sendPush,
  isExpiredPushSubscriptionError: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    ((error as { statusCode: number }).statusCode === 404 ||
      (error as { statusCode: number }).statusCode === 410),
}));

let postNotificationTest: (request: NextRequest) => Promise<Response>;

function request(input?: { body?: string; token?: string }) {
  return new NextRequest("https://jami.test/api/notifications/test", {
    method: "POST",
    headers: {
      ...(input?.token
        ? { Authorization: `Bearer ${input.token}` }
        : {}),
      ...(input?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: input?.body,
  });
}

function validSubscription() {
  return {
    endpoint: "https://push.test/device",
    expirationTime: null,
    keys: { auth: "auth", p256dh: "p256dh" },
  };
}

beforeAll(async () => {
  ({ POST: postNotificationTest } = await import(
    "@/app/api/notifications/test/route"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscriptions.clear();
  mocks.deleted.length = 0;
  mocks.requestedPaths.length = 0;
  mocks.verifyIdToken.mockResolvedValue({ uid: "user-1" });
  mocks.sendPush.mockResolvedValue(undefined);
});

describe("notification test route", () => {
  it("requires a verified bearer token", async () => {
    expect((await postNotificationTest(request())).status).toBe(401);

    mocks.verifyIdToken.mockRejectedValueOnce(new Error("expired"));
    expect(
      (await postNotificationTest(request({ token: "expired-token" }))).status
    ).toBe(401);
    expect(mocks.sendPush).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON instead of silently notifying every device", async () => {
    const response = await postNotificationTest(
      request({ token: "token", body: "{" })
    );

    expect(response.status).toBe(400);
    expect(mocks.requestedPaths).toHaveLength(0);
  });

  it("rejects unsafe document ids before querying Firestore", async () => {
    const response = await postNotificationTest(
      request({
        token: "token",
        body: JSON.stringify({ subscriptionId: "other/device" }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.requestedPaths).toHaveLength(0);
  });

  it("sends only to the requested subscription under the verified user", async () => {
    mocks.subscriptions.set("device-1", validSubscription());

    const response = await postNotificationTest(
      request({
        token: "token",
        body: JSON.stringify({ subscriptionId: "device-1" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.requestedPaths).toEqual([
      "users/user-1/pushSubscriptions/device-1",
    ]);
    expect(mocks.sendPush).toHaveBeenCalledOnce();
  });

  it("does not fall back to another device when the requested one is absent", async () => {
    mocks.subscriptions.set("device-2", validSubscription());

    const response = await postNotificationTest(
      request({
        token: "token",
        body: JSON.stringify({ subscriptionId: "missing-device" }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.sendPush).not.toHaveBeenCalled();
  });

  it("deletes invalid and expired requested subscriptions", async () => {
    mocks.subscriptions.set("invalid-device", { endpoint: "" });
    const invalid = await postNotificationTest(
      request({
        token: "token",
        body: JSON.stringify({ subscriptionId: "invalid-device" }),
      })
    );
    expect(invalid.status).toBe(400);
    expect(mocks.deleted).toContain(
      "users/user-1/pushSubscriptions/invalid-device"
    );

    mocks.subscriptions.set("expired-device", validSubscription());
    mocks.sendPush.mockRejectedValueOnce({ statusCode: 410 });
    const expired = await postNotificationTest(
      request({
        token: "token",
        body: JSON.stringify({ subscriptionId: "expired-device" }),
      })
    );
    expect(expired.status).toBe(400);
    expect(mocks.deleted).toContain(
      "users/user-1/pushSubscriptions/expired-device"
    );
  });

  it("returns 502 for a targeted provider failure", async () => {
    mocks.subscriptions.set("device-1", validSubscription());
    const providerError = Object.assign(new Error("Provider unavailable"), {
      statusCode: 503,
      body: "private provider response body",
    });
    mocks.sendPush.mockRejectedValueOnce(providerError);

    const response = await postNotificationTest(
      request({
        token: "token",
        body: JSON.stringify({ subscriptionId: "device-1" }),
      })
    );

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "The notification provider could not deliver this test just now.",
      failed: 1,
    });
    expect(JSON.stringify(body)).not.toContain("private provider response body");
  });

  it("keeps the empty-body compatibility flow for testing every device", async () => {
    mocks.subscriptions.set("valid-device", validSubscription());
    mocks.subscriptions.set("invalid-device", { endpoint: "" });

    const response = await postNotificationTest(
      request({ token: "token" })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sent: 1,
      removed: 1,
      failed: 0,
    });
    expect(mocks.sendPush).toHaveBeenCalledOnce();
  });
});
