import { describe, expect, it } from "vitest";
import {
  describeAllowancePace,
  describePassAllowance,
  perDayPence,
  describeUpgradeFor,
  getExamPassQuote,
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

  it("offers once a session whatever ran out, never to Pro, Lifetime or billing-off", () => {
    const offered = new Set<string>();
    expect(shouldOfferPlans({ plan: "free", alreadyOffered: offered })).toBe(true);
    offered.add("papers");
    expect(shouldOfferPlans({ plan: "free", alreadyOffered: offered })).toBe(false);
    expect(shouldOfferPlans({ plan: "pro", alreadyOffered: new Set() })).toBe(false);
    expect(shouldOfferPlans({ plan: "lifetime", alreadyOffered: new Set() })).toBe(false);
    expect(shouldOfferPlans({ plan: null, alreadyOffered: new Set() })).toBe(false);
  });

  it("stays away for three days after Not now", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    const base = { plan: "free" as const, alreadyOffered: new Set<string>(), now };
    expect(shouldOfferPlans({ ...base, dismissedAt: now - 2 * day })).toBe(false);
    expect(shouldOfferPlans({ ...base, dismissedAt: now - 3 * day - 1 })).toBe(true);
    expect(shouldOfferPlans({ ...base, dismissedAt: null })).toBe(true);
  });

  it("says what the next plan includes of what ran out", () => {
    expect(describeUpgradeFor("free", "papers")).toBe("Nova includes 8 Jami papers a month.");
    expect(describeUpgradeFor("plus", "papers")).toBe("Celestial includes 14 Jami papers a month.");
    expect(describeUpgradeFor("free", "photos")).toBe("Nova includes 10 Tutor photos a month.");
    expect(describeUpgradeFor("free", "fileCards")).toBe("Nova includes unlimited flashcard batches.");
    expect(describeUpgradeFor("pro", "papers")).toBeNull();
  });

  it("compares the plans from the same numbers that are enforced", () => {
    const papers = getPlanComparisonRows().find((row) => row.key === "papers");
    expect(papers).toEqual({ key: "papers", label: "Jami papers", free: "1 a month", plus: "8 a month", pro: "14 a month" });
    const photos = getPlanComparisonRows().find((row) => row.key === "photos");
    expect(photos?.free).toBe("Not included");
  });
});

describe("the Exam Pass as students weigh it up", () => {
  const october = Date.parse("2026-10-15T10:00:00Z");

  it("leads with what it works out at each month and what it saves", () => {
    expect(getExamPassQuote("plus", october)).toEqual({
      pricePence: 5999,
      months: 10,
      perMonthPence: 600,
      savingPence: 1991,
      discountPercent: 25,
    });
    const pro = getExamPassQuote("pro", october);
    expect(pro.perMonthPence).toBeLessThan(1499);
    expect(pro.savingPence).toBe(1499 * 10 - 12799);
  });

  it("totals each allowance across the pass, with the monthly reset beside it", () => {
    expect(describePassAllowance("plus", "papers", 10)).toEqual({ total: "80", perMonth: "8 a month" });
    expect(describePassAllowance("pro", "tutor", 10)).toEqual({ total: "10,000", perMonth: "1,000 a month" });
    expect(describePassAllowance("plus", "pages", 10)).toEqual({ total: "Unlimited", perMonth: null });
    expect(describePassAllowance("free", "photos", 10)).toEqual({ total: "Not included", perMonth: null });
  });
});

describe("making allowances and prices concrete", () => {
  it("turns a monthly allowance into the pace it would be used at", () => {
    expect(describeAllowancePace("plus", "papers")).toBe("nearly 2 a week");
    expect(describeAllowancePace("pro", "papers")).toBe("about 3 a week");
    expect(describeAllowancePace("plus", "tutor")).toBe("about 17 a day");
    expect(describeAllowancePace("pro", "tutor")).toBe("about 33 a day");
    expect(describeAllowancePace("free", "papers")).toBeNull();
    expect(describeAllowancePace("plus", "pages")).toBeNull();
    expect(describeAllowancePace("free", "photos")).toBeNull();
  });

  it("spreads a monthly price over its days", () => {
    expect(perDayPence(799)).toBe(26);
    expect(perDayPence(1499)).toBe(49);
    expect(perDayPence(600)).toBe(20);
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
