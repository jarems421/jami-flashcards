import { describe, expect, it } from "vitest";
import {
  ACTION_ALLOWANCE,
  ALLOWANCE_KEYS,
  PLAN_ALLOWANCES,
  decideAllowance,
  describeAllowanceRefusal,
  getAllowance,
  getAllowancePeriod,
  getExamPassExpiry,
  getExamPassMonths,
  getExamPassPricePence,
} from "@/lib/billing/plans";

const at = (iso: string) => Date.parse(iso);

describe("plan allowances", () => {
  it("has the limits agreed in the pricing doc", () => {
    expect(PLAN_ALLOWANCES.plus.papers.limit).toBe(6);
    expect(PLAN_ALLOWANCES.pro.papers.limit).toBe(12);
    expect(PLAN_ALLOWANCES.plus.photos.limit).toBe(10);
    expect(PLAN_ALLOWANCES.pro.photos.limit).toBe(24);
    expect(PLAN_ALLOWANCES.plus.videos.limit).toBe(30);
    expect(PLAN_ALLOWANCES.pro.videos.limit).toBe(60);
    expect(PLAN_ALLOWANCES.plus.tutor.limit).toBe(500);
    expect(PLAN_ALLOWANCES.pro.tutor.limit).toBe(1_000);
    expect(PLAN_ALLOWANCES.free.photos.limit).toBe(0);
  });

  it("shows the cheap things as unlimited and still caps them", () => {
    for (const plan of ["plus", "pro"] as const) {
      for (const key of ["fileCards", "drafts", "pages", "answerChecks"] as const) {
        expect(PLAN_ALLOWANCES[plan][key].shown).toBe("unlimited");
        expect(PLAN_ALLOWANCES[plan][key].limit).toBeGreaterThan(0);
      }
    }
    expect(PLAN_ALLOWANCES.plus.pages.limit).toBe(10_000);
    expect(PLAN_ALLOWANCES.pro.pages.limit).toBe(20_000);
  });

  it("defines every allowance on every plan", () => {
    for (const plan of ["free", "plus", "pro"] as const) {
      expect(Object.keys(PLAN_ALLOWANCES[plan]).sort()).toEqual([...ALLOWANCE_KEYS].sort());
    }
  });

  it("maps every allowance an action spends to a real allowance", () => {
    for (const key of Object.values(ACTION_ALLOWANCE)) {
      if (key !== null) expect(ALLOWANCE_KEYS).toContain(key);
    }
    // A practice set is not a paper.
    expect(ACTION_ALLOWANCE.sourcePracticeDrafts).toBe("filePractice");
    expect(ACTION_ALLOWANCE.practicePaperGeneration).toBe("papers");
  });

  it("gives lifetime accounts no monthly limits at all", () => {
    for (const key of ALLOWANCE_KEYS) expect(getAllowance("lifetime", key)).toBeNull();
    expect(
      decideAllowance({ plan: "lifetime", key: "papers", usage: { used: { papers: 999 }, extra: {} } })
    ).toEqual({ allowed: true, remainingAfter: null });
  });
});

describe("deciding an allowance", () => {
  it("allows until the limit, then refuses", () => {
    const usage = { used: { papers: 5 }, extra: {} };
    expect(decideAllowance({ plan: "plus", key: "papers", usage })).toEqual({
      allowed: true,
      remainingAfter: 0,
    });
    expect(
      decideAllowance({ plan: "plus", key: "papers", usage: { used: { papers: 6 }, extra: {} } })
    ).toEqual({ allowed: false, limit: 6, used: 6 });
  });

  it("adds bought extras on top of the plan", () => {
    expect(
      decideAllowance({
        plan: "plus",
        key: "papers",
        usage: { used: { papers: 6 }, extra: { papers: 2 } },
      }).allowed
    ).toBe(true);
  });

  it("lets a large amount through while anything is left", () => {
    // A 120-page pack with 100 pages left runs; the next one does not.
    const decision = decideAllowance({
      plan: "free",
      key: "pages",
      usage: { used: { pages: 400 }, extra: {} },
      amount: 120,
    });
    expect(decision.allowed).toBe(true);
    expect(
      decideAllowance({ plan: "free", key: "pages", usage: { used: { pages: 520 }, extra: {} } })
        .allowed
    ).toBe(false);
  });

  it("refuses Free a photo outright", () => {
    expect(
      decideAllowance({ plan: "free", key: "photos", usage: { used: {}, extra: {} } }).allowed
    ).toBe(false);
  });

  it("says what ran out, when it resets and what includes more", () => {
    const message = describeAllowanceRefusal({
      plan: "plus",
      key: "papers",
      periodEnd: at("2026-11-14T09:00:00Z"),
    });
    expect(message).toContain("Jami papers");
    expect(message).toContain("14 November");
    expect(message).toContain("Pro includes more");
  });
});

describe("allowance periods", () => {
  it("runs from the plan's anniversary, not the 1st", () => {
    const period = getAllowancePeriod(at("2026-09-28T10:00:00Z"), at("2026-10-02T00:00:00Z"));
    expect(period.key).toBe("2026-09-28");
    expect(new Date(period.end).toISOString()).toBe("2026-10-28T10:00:00.000Z");
  });

  it("moves to the next period on the anniversary itself", () => {
    const period = getAllowancePeriod(at("2026-09-28T10:00:00Z"), at("2026-10-28T10:00:00Z"));
    expect(period.key).toBe("2026-10-28");
  });

  it("renews a 31st start on the last day of shorter months", () => {
    const anchor = at("2026-01-31T12:00:00Z");
    expect(getAllowancePeriod(anchor, at("2026-02-28T13:00:00Z")).key).toBe("2026-02-28");
    expect(getAllowancePeriod(anchor, at("2026-03-15T00:00:00Z")).key).toBe("2026-02-28");
    expect(getAllowancePeriod(anchor, at("2026-03-31T12:00:00Z")).key).toBe("2026-03-31");
  });

  it("crosses the new year", () => {
    const period = getAllowancePeriod(at("2026-06-20T00:00:00Z"), at("2027-01-05T00:00:00Z"));
    expect(period.key).toBe("2026-12-20");
    expect(new Date(period.end).toISOString().slice(0, 10)).toBe("2027-01-20");
  });
});

describe("the Exam Pass", () => {
  it("prices to the doc's table", () => {
    expect(getExamPassPricePence("plus", at("2026-09-15T00:00:00Z"))).toBe(5_999);
    expect(getExamPassPricePence("pro", at("2026-10-15T00:00:00Z"))).toBe(12_799);
    expect(getExamPassPricePence("plus", at("2027-01-15T00:00:00Z"))).toBe(4_199);
    expect(getExamPassPricePence("pro", at("2027-01-15T00:00:00Z"))).toBe(8_999);
    expect(getExamPassPricePence("plus", at("2027-03-15T00:00:00Z"))).toBe(2_999);
    expect(getExamPassPricePence("pro", at("2027-05-15T00:00:00Z"))).toBe(3_899);
  });

  it("counts August and September as a whole exam year", () => {
    expect(getExamPassMonths(at("2026-08-10T00:00:00Z"))).toBe(10);
    expect(getExamPassMonths(at("2026-09-10T00:00:00Z"))).toBe(10);
    expect(getExamPassMonths(at("2026-12-10T00:00:00Z"))).toBe(8);
    expect(getExamPassMonths(at("2027-07-10T00:00:00Z"))).toBe(1);
  });

  it("lasts until the end of 31 July of its exam year", () => {
    expect(new Date(getExamPassExpiry(at("2026-09-10T00:00:00Z"))).toISOString()).toBe(
      "2027-07-31T23:59:59.999Z"
    );
    expect(new Date(getExamPassExpiry(at("2027-03-10T00:00:00Z"))).toISOString()).toBe(
      "2027-07-31T23:59:59.999Z"
    );
  });
});
