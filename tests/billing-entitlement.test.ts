import { describe, expect, it } from "vitest";
import { parseBillingLaunchAt, resolveEntitlement } from "@/lib/billing/entitlement";

const LAUNCH = Date.parse("2026-11-01T00:00:00Z");
const NOW = Date.parse("2026-12-10T00:00:00Z");
const BEFORE = Date.parse("2026-09-01T00:00:00Z");
const AFTER = Date.parse("2026-11-20T00:00:00Z");

describe("which plan a student is on", () => {
  it("makes everyone who joined before launch Lifetime, with no plan written", () => {
    expect(resolveEntitlement({ stored: null, accountCreatedAt: BEFORE, launchAt: LAUNCH, now: NOW }).plan).toBe(
      "lifetime"
    );
  });

  it("puts a new account on Free, counted from the day it was made", () => {
    expect(resolveEntitlement({ stored: null, accountCreatedAt: AFTER, launchAt: LAUNCH, now: NOW })).toEqual({
      plan: "free",
      source: "free",
      anchor: AFTER,
    });
  });

  it("never paywalls anyone when it cannot tell", () => {
    // No launch date set, or an account whose age could not be read.
    expect(resolveEntitlement({ stored: null, accountCreatedAt: AFTER, launchAt: null, now: NOW }).plan).toBe("lifetime");
    expect(resolveEntitlement({ stored: null, accountCreatedAt: null, launchAt: LAUNCH, now: NOW }).plan).toBe("lifetime");
  });

  it("keeps a live subscription's plan, and a cancelled one to the end of what was paid", () => {
    const base = { plan: "pro", source: "subscription", periodAnchor: AFTER };
    expect(resolveEntitlement({ stored: { ...base, status: "active" }, accountCreatedAt: AFTER, launchAt: LAUNCH, now: NOW }).plan).toBe("pro");
    expect(
      resolveEntitlement({
        stored: { ...base, status: "canceled", currentPeriodEnd: NOW + 86_400_000 },
        accountCreatedAt: AFTER,
        launchAt: LAUNCH,
        now: NOW,
      }).plan
    ).toBe("pro");
    expect(
      resolveEntitlement({
        stored: { ...base, status: "canceled", currentPeriodEnd: NOW - 1 },
        accountCreatedAt: AFTER,
        launchAt: LAUNCH,
        now: NOW,
      }).plan
    ).toBe("free");
  });

  it("ends an Exam Pass on its expiry", () => {
    const pass = { plan: "plus", source: "pass", periodAnchor: AFTER };
    expect(resolveEntitlement({ stored: { ...pass, passExpiresAt: NOW + 1 }, accountCreatedAt: AFTER, launchAt: LAUNCH, now: NOW }).plan).toBe("plus");
    expect(resolveEntitlement({ stored: { ...pass, passExpiresAt: NOW - 1 }, accountCreatedAt: AFTER, launchAt: LAUNCH, now: NOW }).plan).toBe("free");
  });

  it("drops a lapsed plan back to Lifetime for an early account, not Free", () => {
    const lapsed = { plan: "plus", source: "subscription", status: "canceled", currentPeriodEnd: NOW - 1 };
    expect(resolveEntitlement({ stored: lapsed, accountCreatedAt: BEFORE, launchAt: LAUNCH, now: NOW }).plan).toBe("lifetime");
  });

  it("reads the launch date as an ISO date or milliseconds", () => {
    expect(parseBillingLaunchAt("2026-11-01T00:00:00Z")).toBe(LAUNCH);
    expect(parseBillingLaunchAt(String(LAUNCH))).toBe(LAUNCH);
    expect(parseBillingLaunchAt("")).toBeNull();
    expect(parseBillingLaunchAt("soon")).toBeNull();
  });
});
