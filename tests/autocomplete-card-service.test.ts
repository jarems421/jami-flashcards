import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as { getIdToken: () => Promise<string> } | null },
}));

vi.mock("@/services/firebase/client", () => ({ auth: mocks.auth }));

const { autocompleteCardBack } = await import(
  "@/services/ai/autocomplete-card"
);

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.auth.currentUser = { getIdToken: async () => "test-token" };
});

describe("card autocomplete client service", () => {
  it("keeps a daily limit distinct from a short burst", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Daily limit", code: "daily_limit" },
          { status: 429 }
        )
      )
    );

    await expect(
      autocompleteCardBack({ front: "What is ATP?" })
    ).rejects.toThrow(/tomorrow/i);
  });

  it("describes a burst rejection as a short break", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Burst limit", code: "burst_limit" },
          { status: 429 }
        )
      )
    );

    await expect(
      autocompleteCardBack({ front: "What is ATP?" })
    ).rejects.toThrow(/short break/i);
  });

  it("surfaces a budget-store outage separately from deployment configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "AI usage limits are temporarily unavailable. Try again shortly.",
            code: "budget_unavailable",
          },
          { status: 503 }
        )
      )
    );

    await expect(
      autocompleteCardBack({ front: "What is ATP?" })
    ).rejects.toThrow(/usage limits are temporarily unavailable/i);
  });
});
