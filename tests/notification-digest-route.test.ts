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

  it("runs every hour: each student's own clock decides what is due, not the route", async () => {
    vi.setSystemTime(new Date("2026-07-01T03:00:00.000Z"));

    const response = await getDigest(request("cron-secret"));

    expect(response.status).toBe(200);
    expect(mocks.runDigest).toHaveBeenCalledWith(
      expect.objectContaining({ now: new Date("2026-07-01T03:00:00.000Z").getTime() })
    );
  });

  it("returns the bounded runner summary", async () => {
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

  it("is scheduled once in every hour of the day, as daily jobs a Hobby plan accepts", async () => {
    const { readFileSync } = await import("node:fs");
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const digestRuns = config.crons.filter((cron) => cron.path.startsWith("/api/notifications/digest"));

    expect(digestRuns.map((cron) => cron.schedule).sort()).toEqual(
      Array.from({ length: 24 }, (_, hour) => `0 ${hour} * * *`).sort()
    );
    expect(new Set(digestRuns.map((cron) => cron.path)).size).toBe(24);
  });
});
