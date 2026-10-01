import { describe, expect, it } from "vitest";
import { buildPlanSummary } from "@/lib/billing/summary";

const period = {
  key: "2026-10-01",
  start: Date.parse("2026-10-01T09:00:00Z"),
  end: Date.parse("2026-11-01T09:00:00Z"),
};

describe("the plan summary on the Account page", () => {
  it("shows nothing while billing is off", () => {
    expect(buildPlanSummary({ entitlement: null, usage: { used: {}, extra: {} }, period: null })).toEqual({
      enabled: false,
    });
  });

  it("lists what is left, with bought extras added on", () => {
    const summary = buildPlanSummary({
      entitlement: { plan: "plus", source: "subscription", anchor: period.start },
      usage: { used: { papers: 4, tutor: 120 }, extra: { papers: 1 } },
      period,
    });
    if (!summary.enabled) throw new Error("expected a summary");
    expect(summary.label).toBe("Plus");
    expect(summary.resetsAt).toBe(period.end);
    const items = summary.groups.flatMap((group) => group.items);
    expect(items.find((item) => item.key === "papers")).toMatchObject({ limit: 7, used: 4, remaining: 3 });
    expect(items.find((item) => item.key === "tutor")).toMatchObject({ remaining: 380 });
    expect(items.find((item) => item.key === "fileCards")?.shown).toBe("unlimited");
  });

  it("never shows more used than the limit, or a negative remainder", () => {
    const summary = buildPlanSummary({
      entitlement: { plan: "free", source: "free", anchor: period.start },
      usage: { used: { pages: 620 }, extra: {} },
      period,
    });
    if (!summary.enabled) throw new Error("expected a summary");
    const pages = summary.groups.flatMap((group) => group.items).find((item) => item.key === "pages");
    expect(pages).toMatchObject({ limit: 500, used: 500, remaining: 0 });
  });

  it("leaves out what a plan does not include at all", () => {
    const summary = buildPlanSummary({
      entitlement: { plan: "free", source: "free", anchor: period.start },
      usage: { used: {}, extra: {} },
      period,
    });
    if (!summary.enabled) throw new Error("expected a summary");
    expect(summary.groups.flatMap((group) => group.items).some((item) => item.key === "photos")).toBe(false);
  });

  it("shows Lifetime with no counters and no reset", () => {
    expect(
      buildPlanSummary({
        entitlement: { plan: "lifetime", source: "lifetime", anchor: 0 },
        usage: { used: { papers: 50 }, extra: {} },
        period,
      })
    ).toMatchObject({ enabled: true, plan: "lifetime", resetsAt: null, groups: [] });
  });
});
