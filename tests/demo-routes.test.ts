import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIssueDemoCustomToken = vi.fn();
const mockResetDemoWorkspace = vi.fn();

vi.mock("@/services/demo/admin", () => ({
  issueDemoCustomToken: mockIssueDemoCustomToken,
  resetDemoWorkspace: mockResetDemoWorkspace,
}));

const envSnapshot = {
  DEMO_MODE_ENABLED: process.env.DEMO_MODE_ENABLED,
  NEXT_PUBLIC_DEMO_MODE_ENABLED: process.env.NEXT_PUBLIC_DEMO_MODE_ENABLED,
  DEMO_RESET_SECRET: process.env.DEMO_RESET_SECRET,
  CRON_SECRET: process.env.CRON_SECRET,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.DEMO_MODE_ENABLED = "true";
  process.env.NEXT_PUBLIC_DEMO_MODE_ENABLED = "true";
  process.env.DEMO_RESET_SECRET = "demo-reset-secret";
  process.env.CRON_SECRET = "cron-secret";
});

afterEach(() => {
  process.env.DEMO_MODE_ENABLED = envSnapshot.DEMO_MODE_ENABLED;
  process.env.NEXT_PUBLIC_DEMO_MODE_ENABLED = envSnapshot.NEXT_PUBLIC_DEMO_MODE_ENABLED;
  process.env.DEMO_RESET_SECRET = envSnapshot.DEMO_RESET_SECRET;
  process.env.CRON_SECRET = envSnapshot.CRON_SECRET;
});

describe("demo route handlers", () => {
  it("returns 503 when demo login is disabled", async () => {
    process.env.DEMO_MODE_ENABLED = "false";
    process.env.NEXT_PUBLIC_DEMO_MODE_ENABLED = "false";
    const { POST } = await import("@/app/api/demo/login/route");

    const response = await POST();

    expect(response.status).toBe(503);
  });

  it("returns a custom token for demo login when enabled", async () => {
    mockIssueDemoCustomToken.mockResolvedValue("demo-token");
    const { POST } = await import("@/app/api/demo/login/route");

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ token: "demo-token" });
    expect(mockIssueDemoCustomToken).toHaveBeenCalledTimes(1);
  });

  it("surfaces demo login failures when the demo user is not configured", async () => {
    mockIssueDemoCustomToken.mockRejectedValue(new Error("Missing DEMO_USER_ID."));
    const { POST } = await import("@/app/api/demo/login/route");

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain("DEMO_USER_ID");
  });

  it("rejects demo reset without a valid secret", async () => {
    const { POST } = await import("@/app/api/demo/reset/route");

    const response = await POST(
      new Request("http://localhost/api/demo/reset", {
        method: "POST",
      })
    );

    expect(response.status).toBe(401);
  });

  it("returns reset results for authorized demo reset requests", async () => {
    mockResetDemoWorkspace.mockResolvedValue({
      ok: true,
      counts: {
        decks: 3,
        cards: 12,
      },
    });
    const { POST } = await import("@/app/api/demo/reset/route");

    const response = await POST(
      new Request("http://localhost/api/demo/reset", {
        method: "POST",
        headers: {
          authorization: "Bearer demo-reset-secret",
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.counts.cards).toBe(12);
  });

  it("keeps demo reset idempotent across repeated authorized calls", async () => {
    mockResetDemoWorkspace.mockResolvedValue({
      ok: true,
      counts: {
        decks: 3,
        cards: 12,
      },
    });
    const { GET } = await import("@/app/api/demo/reset/route");

    const request = new Request("http://localhost/api/demo/reset", {
      headers: {
        authorization: "Bearer cron-secret",
      },
    });

    const first = await GET(request);
    const second = await GET(request);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockResetDemoWorkspace).toHaveBeenCalledTimes(2);
  });
});
