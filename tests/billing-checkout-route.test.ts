import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getEntitlement: vi.fn(),
  getStripeConfig: vi.fn(),
  stripePost: vi.fn(),
}));

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
}));
vi.mock("@/services/billing/entitlements.server", () => ({ getEntitlement: mocks.getEntitlement }));
vi.mock("@/services/billing/stripe.server", () => ({
  getStripeConfig: mocks.getStripeConfig,
  stripePost: mocks.stripePost,
}));

const { POST } = await import("@/app/api/billing/checkout/route");

function request(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost/api/billing/checkout"), {
    method: "POST",
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const config = { secretKey: "sk", webhookSecret: "whsec", priceIds: { plus: "price_plus", pro: "price_pro" } };

describe("starting a purchase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyIdToken.mockResolvedValue({ uid: "user-1", email: "s@example.com" });
    mocks.getEntitlement.mockResolvedValue({ plan: "free", source: "free", anchor: 0 });
    mocks.getStripeConfig.mockReturnValue(config);
    mocks.stripePost.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/abc" });
  });

  it("opens a Stripe Checkout once the waiver is ticked", async () => {
    const response = await POST(request({ plan: "plus", kind: "subscription", waiverAccepted: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/abc" });
    expect(mocks.stripePost).toHaveBeenCalledWith(
      config,
      "checkout/sessions",
      expect.objectContaining({ mode: "subscription", client_reference_id: "user-1" })
    );
  });

  it("refuses without the waiver", async () => {
    const response = await POST(request({ plan: "plus", kind: "subscription" }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("waiver_required");
  });

  it("takes no money until payments are fully set up", async () => {
    mocks.getStripeConfig.mockReturnValue(null);
    const response = await POST(request({ plan: "plus", kind: "subscription", waiverAccepted: true }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("payments_not_configured");
    expect(mocks.stripePost).not.toHaveBeenCalled();
  });

  it("never sells to a Lifetime account, or the plan a student is already on", async () => {
    mocks.getEntitlement.mockResolvedValue({ plan: "lifetime", source: "lifetime", anchor: 0 });
    expect((await POST(request({ plan: "pro", kind: "subscription", waiverAccepted: true }))).status).toBe(409);
    mocks.getEntitlement.mockResolvedValue({ plan: "plus", source: "subscription", anchor: 0 });
    expect((await POST(request({ plan: "plus", kind: "subscription", waiverAccepted: true }))).status).toBe(409);
    expect(mocks.stripePost).not.toHaveBeenCalled();
  });

  it("rejects anything that is not a plan", async () => {
    expect((await POST(request({ plan: "lifetime", kind: "subscription", waiverAccepted: true }))).status).toBe(400);
    expect((await POST(request({ plan: "plus", kind: "annual", waiverAccepted: true }))).status).toBe(400);
  });
});
