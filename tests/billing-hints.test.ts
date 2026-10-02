import { describe, expect, it } from "vitest";
import { getAllowanceHint, getAllowanceHintPlansHref, getLowAllowanceThreshold } from "@/lib/billing/hints";
import { buildPlanSummary } from "@/lib/billing/summary";
import type { AllowanceKey } from "@/lib/billing/plans";

const period = {
  key: "2026-10-14",
  start: Date.parse("2026-10-14T09:00:00Z"),
  end: Date.parse("2026-11-14T09:00:00Z"),
};

function summaryFor(plan: "free" | "plus" | "pro" | "lifetime", used: Partial<Record<AllowanceKey, number>>) {
  return buildPlanSummary({
    entitlement: { plan, source: plan === "lifetime" ? "lifetime" : "subscription", anchor: period.start },
    usage: { used, extra: {} },
    period,
  });
}

describe("allowance hints", () => {
  it("says nothing about the Tutor until only a few questions are left", () => {
    expect(getAllowanceHint({ summary: summaryFor("plus", { tutor: 300 }), key: "tutor", mode: "low" })).toBeNull();
    expect(getAllowanceHint({ summary: summaryFor("plus", { tutor: 492 }), key: "tutor", mode: "low" })).toBe(
      "8 Tutor messages left until 14 November"
    );
    expect(getAllowanceHint({ summary: summaryFor("plus", { tutor: 499 }), key: "tutor", mode: "low" })).toBe(
      "1 Tutor message left until 14 November"
    );
  });

  it("always counts papers beside the button", () => {
    expect(getAllowanceHint({ summary: summaryFor("plus", { papers: 2 }), key: "papers", mode: "always" })).toBe(
      "6 of 8 Jami papers left this month"
    );
  });

  it("says when something has run out and when it comes back", () => {
    expect(getAllowanceHint({ summary: summaryFor("plus", { papers: 8 }), key: "papers", mode: "always" })).toBe(
      "No Jami papers left until 14 November"
    );
  });

  it("never counts what is shown as unlimited, or anything on Lifetime", () => {
    expect(
      getAllowanceHint({ summary: summaryFor("plus", { fileCards: 299 }), key: "fileCards", mode: "low" })
    ).toBeNull();
    expect(getAllowanceHint({ summary: summaryFor("lifetime", { papers: 99 }), key: "papers", mode: "always" })).toBeNull();
    expect(getAllowanceHint({ summary: null, key: "papers", mode: "always" })).toBeNull();
    expect(getAllowanceHint({ summary: { enabled: false }, key: "papers", mode: "always" })).toBeNull();
  });

  it("warns a fifth of the way from the end, never more than ten and never fewer than one", () => {
    expect(getLowAllowanceThreshold(1_000)).toBe(10);
    expect(getLowAllowanceThreshold(30)).toBe(6);
    expect(getLowAllowanceThreshold(6)).toBe(2);
    expect(getLowAllowanceThreshold(1)).toBe(1);
  });
});

describe("where hints point at plans", () => {
  it("links to plans only once a hint is a warning, and only with a plan to move up to", () => {
    expect(getAllowanceHintPlansHref({ summary: summaryFor("plus", { papers: 2 }), key: "papers" })).toBeNull();
    expect(getAllowanceHintPlansHref({ summary: summaryFor("plus", { papers: 7 }), key: "papers" })).toBe(
      "/dashboard/plans?for=papers"
    );
    expect(getAllowanceHintPlansHref({ summary: summaryFor("free", { papers: 1 }), key: "papers" })).toBe(
      "/dashboard/plans?for=papers"
    );
    expect(getAllowanceHintPlansHref({ summary: summaryFor("pro", { papers: 14 }), key: "papers" })).toBeNull();
    expect(getAllowanceHintPlansHref({ summary: summaryFor("lifetime", { papers: 99 }), key: "papers" })).toBeNull();
  });

  it("nudges after a success only once the last one is used", () => {
    expect(getAllowanceHint({ summary: summaryFor("free", { papers: 0 }), key: "papers", mode: "nudge" })).toBeNull();
    expect(getAllowanceHint({ summary: summaryFor("free", { papers: 1 }), key: "papers", mode: "nudge" })).toBe(
      "Want another before 14 November? Nova includes 8 Jami papers a month."
    );
    expect(getAllowanceHint({ summary: summaryFor("pro", { papers: 14 }), key: "papers", mode: "nudge" })).toBeNull();
  });
});
