import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  runDigest: vi.fn(),
}));

vi.mock("@/services/notifications/digest", () => ({
  runNotificationDigest: mocks.runDigest,
}));

let getDigest: (request: NextRequest) => Promise<Response>;

function request(secret?: string) {
  return new NextRequest("https://jami.test/api/notifications/digest", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

beforeAll(async () => {
  ({ GET: getDigest } = await import(
    "@/app/api/notifications/digest/route"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-01T15:05:00.000Z"));
  vi.stubEnv("CRON_SECRET", "cron-secret");
  mocks.runDigest.mockResolvedValue({
    considered: 2,
    claimed: 1,
    sent: 1,
    removed: 0,
    skipped: 1,
    failed: 0,
    partial: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("notification digest cron route", () => {
  it("returns 503 when CRON_SECRET is absent or blank", async () => {
    vi.stubEnv("CRON_SECRET", "   ");

    const response = await getDigest(request("anything"));

    expect(response.status).toBe(503);
    expect(mocks.runDigest).not.toHaveBeenCalled();
  });

  it("rejects missing and incorrect bearer credentials", async () => {
    expect((await getDigest(request())).status).toBe(401);
    expect((await getDigest(request("wrong"))).status).toBe(401);
    expect(mocks.runDigest).not.toHaveBeenCalled();
  });

  it("skips an authenticated invocation outside the study boundary", async () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const response = await getDigest(request("cron-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      skipped: true,
      reason: "outside-study-window",
    });
    expect(mocks.runDigest).not.toHaveBeenCalled();
  });

  it("returns the bounded runner summary inside the study window", async () => {
    const response = await getDigest(request("cron-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      considered: 2,
      sent: 1,
      failed: 0,
      partial: false,
    });
    expect(mocks.runDigest).toHaveBeenCalledWith(
      expect.objectContaining({
        now: new Date("2026-07-01T15:05:00.000Z").getTime(),
      })
    );
  });

  it("returns a generic 500 when top-level orchestration fails", async () => {
    mocks.runDigest.mockRejectedValueOnce(new Error("Firestore unavailable"));

    const response = await getDigest(request("cron-secret"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Notification digest could not be completed.",
    });
  });

  it("gives the winter alias the same explicit duration budget", async () => {
    const winterRoute = await import(
      "@/app/api/notifications/digest-winter/route"
    );

    expect(winterRoute.maxDuration).toBe(300);
    expect(winterRoute.GET).toBe(getDigest);
  });
});
