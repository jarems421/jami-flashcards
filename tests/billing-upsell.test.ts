import { describe, expect, it } from "vitest";
import {
  describeUpgradeFor,
  getPlanComparisonRows,
  shouldOfferPlans,
  suggestedUpgrade,
} from "@/lib/billing/upsell";
import { buildCheckoutSessionFields } from "@/lib/billing/checkout";

describe("when plans are offered", () => {
  it("offers the next plan up, and nothing above Pro or to Lifetime", () => {
    expect(suggestedUpgrade("free")).toBe("plus");
    expect(suggestedUpgrade("plus")).toBe("pro");
    expect(suggestedUpgrade("pro")).toBeNull();
    expect(suggestedUpgrade("lifetime")).toBeNull();
  });

  it("offers once per allowance per session, never to Pro, Lifetime or billing-off", () => {
    const offered = new Set<string>();
    expect(shouldOfferPlans({ plan: "free", key: "papers", alreadyOffered: offered })).toBe(true);
    offered.add("papers");
    expect(shouldOfferPlans({ plan: "free", key: "papers", alreadyOffered: offered })).toBe(false);
    expect(shouldOfferPlans({ plan: "free", key: "tutor", alreadyOffered: offered })).toBe(true);
    expect(shouldOfferPlans({ plan: "pro", key: "tutor", alreadyOffered: new Set() })).toBe(false);
    expect(shouldOfferPlans({ plan: "lifetime", key: "tutor", alreadyOffered: new Set() })).toBe(false);
    expect(shouldOfferPlans({ plan: null, key: "tutor", alreadyOffered: new Set() })).toBe(false);
  });

  it("says what the next plan includes of what ran out", () => {
    expect(describeUpgradeFor("free", "papers")).toBe("Plus includes 6 Jami papers a month.");
    expect(describeUpgradeFor("plus", "papers")).toBe("Pro includes 12 Jami papers a month.");
    expect(describeUpgradeFor("free", "photos")).toBe("Plus includes 10 Tutor photos a month.");
    expect(describeUpgradeFor("free", "fileCards")).toBe("Plus includes unlimited flashcard batches.");
    expect(describeUpgradeFor("pro", "papers")).toBeNull();
  });

  it("compares the plans from the same numbers that are enforced", () => {
    const papers = getPlanComparisonRows().find((row) => row.key === "papers");
    expect(papers).toEqual({ key: "papers", label: "Jami papers", free: "1 a month", plus: "6 a month", pro: "12 a month" });
    const photos = getPlanComparisonRows().find((row) => row.key === "photos");
    expect(photos?.free).toBe("Not included");
  });
});

describe("the Stripe checkout session", () => {
  const base = {
    uid: "user-1",
    email: "student@example.com",
    priceIds: { plus: "price_plus", pro: "price_pro" },
    origin: "https://jami.example",
    now: Date.parse("2026-10-15T10:00:00Z"),
    forParent: false,
  };

  it("subscribes to the plan's fixed price and names the student everywhere", () => {
    const fields = buildCheckoutSessionFields({ ...base, plan: "plus", kind: "subscription" });
    expect(fields).toMatchObject({
      mode: "subscription",
      "line_items[0][price]": "price_plus",
      client_reference_id: "user-1",
      "metadata[uid]": "user-1",
      "subscription_data[metadata][uid]": "user-1",
      billing_address_collection: "required",
      customer_email: "student@example.com",
    });
    expect(fields["metadata[waiverAcceptedAt]"]).toBe(String(base.now));
  });

  it("prices an Exam Pass from the months left and records when it ends", () => {
    const fields = buildCheckoutSessionFields({ ...base, plan: "pro", kind: "pass" });
    expect(fields.mode).toBe("payment");
    expect(fields["line_items[0][price_data][currency]"]).toBe("gbp");
    expect(fields["line_items[0][price_data][unit_amount]"]).toBe("12799");
    expect(fields["line_items[0][price_data][product_data][name]"]).toContain("31 July 2027");
    expect(fields["metadata[passExpiresAt]"]).toBe(String(Date.parse("2027-07-31T23:59:59.999Z")));
  });

  it("leaves the student's email off a link made for a parent", () => {
    const fields = buildCheckoutSessionFields({ ...base, plan: "plus", kind: "subscription", forParent: true });
    expect(fields.customer_email).toBeUndefined();
    expect(fields["metadata[forParent]"]).toBe("true");
  });
});
