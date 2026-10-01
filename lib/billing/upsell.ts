import {
  ALLOWANCE_KEYS,
  ALLOWANCE_LABELS,
  EXAM_PASS_DISCOUNT,
  PLAN_ALLOWANCES,
  PLAN_PRICES_PENCE,
  getExamPassMonths,
  getExamPassPricePence,
  type AllowanceKey,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/plans";

/**
 * When Jami offers plans, and what it shows when it does.
 *
 * Most buyers are under 18 (docs/plans-and-stardust.md §1), so the rules are
 * deliberately narrow: plans are offered at the one moment a student has
 * genuinely hit something -- an allowance used up, or a feature their plan
 * does not include -- and once per allowance per session at that. Never on
 * opening the app, never mid-study unprompted, never on a countdown, and
 * never at all to a Lifetime account.
 */

/** The plan worth suggesting from this one, or null where there is nothing above it. */
export function suggestedUpgrade(plan: PlanId): PaidPlanId | null {
  if (plan === "free") return "plus";
  if (plan === "plus") return "pro";
  return null;
}

/**
 * Whether running out of `key` should open the plans sheet.
 *
 * Pro has nothing to move up to, so it only ever gets the inline message with
 * the reset date. A sheet already shown for this allowance this session is
 * not shown again: the second refusal is the inline message alone.
 */
export function shouldOfferPlans(input: {
  plan: PlanId | null;
  key: AllowanceKey | null;
  alreadyOffered: ReadonlySet<string>;
}) {
  if (!input.plan || !suggestedUpgrade(input.plan)) return false;
  return !input.alreadyOffered.has(input.key ?? "any");
}

/** "6 a month", "Unlimited" or "Not included", for one allowance on one plan. */
export function describePlanAllowance(plan: Exclude<PlanId, "lifetime">, key: AllowanceKey) {
  const allowance = PLAN_ALLOWANCES[plan][key];
  if (allowance.shown === "unlimited") return "Unlimited";
  if (allowance.limit === 0) return "Not included";
  return `${allowance.limit.toLocaleString("en-GB")} a month`;
}

/**
 * The rows of the plan comparison: the counted things a student weighs up,
 * most decisive first. The everyday features that are unlimited on every paid
 * plan are summed up in one line on the page rather than listed.
 */
export const PLAN_COMPARISON_KEYS: AllowanceKey[] = [
  "papers",
  "answers",
  "tutor",
  "searches",
  "photos",
  "videos",
  "revisionSessions",
  "paperMarkings",
  "diagramLabels",
];

export type PlanComparisonRow = {
  key: AllowanceKey;
  label: string;
  free: string;
  plus: string;
  pro: string;
};

export function getPlanComparisonRows(): PlanComparisonRow[] {
  return PLAN_COMPARISON_KEYS.filter((key) => ALLOWANCE_KEYS.includes(key)).map((key) => {
    const label = ALLOWANCE_LABELS[key];
    return {
      key,
      label: `${label[0].toUpperCase()}${label.slice(1)}`,
      free: describePlanAllowance("free", key),
      plus: describePlanAllowance("plus", key),
      pro: describePlanAllowance("pro", key),
    };
  });
}

/** What the suggested plan includes of the allowance that just ran out, for the sheet. */
export function describeUpgradeFor(plan: PlanId, key: AllowanceKey | null) {
  const next = suggestedUpgrade(plan);
  if (!next) return null;
  const name = next === "plus" ? "Plus" : "Pro";
  if (!key) return `${name} includes more of everything.`;
  const amount = describePlanAllowance(next, key);
  const label = ALLOWANCE_LABELS[key];
  return amount === "Unlimited"
    ? `${name} includes unlimited ${label}.`
    : `${name} includes ${amount.replace(" a month", "")} ${label} a month.`;
}

/**
 * An Exam Pass in the terms a student weighs it up in: what it works out at
 * each month, and what it saves against paying monthly for the same months.
 * The pass is sold as the cheaper way to pay, so the page leads with the
 * monthly figure rather than one large number that looks dearer than monthly.
 */
export type ExamPassQuote = {
  pricePence: number;
  months: number;
  perMonthPence: number;
  savingPence: number;
  discountPercent: number;
};

export function getExamPassQuote(plan: PaidPlanId, now: number): ExamPassQuote {
  const months = getExamPassMonths(now);
  const pricePence = getExamPassPricePence(plan, now);
  return {
    pricePence,
    months,
    perMonthPence: Math.round(pricePence / months),
    savingPence: PLAN_PRICES_PENCE[plan] * months - pricePence,
    discountPercent: Math.round(EXAM_PASS_DISCOUNT[plan] * 100),
  };
}

/**
 * One allowance across a whole pass: "60" with "6 a month" beside it. Pass
 * allowances still reset monthly, so the monthly figure always goes with the
 * total; the total alone would read as a pot to spend in one week.
 */
export function describePassAllowance(
  plan: Exclude<PlanId, "lifetime">,
  key: AllowanceKey,
  months: number
): { total: string; perMonth: string | null } {
  const allowance = PLAN_ALLOWANCES[plan][key];
  if (allowance.shown === "unlimited") return { total: "Unlimited", perMonth: null };
  if (allowance.limit === 0) return { total: "Not included", perMonth: null };
  return {
    total: (allowance.limit * months).toLocaleString("en-GB"),
    perMonth: `${allowance.limit.toLocaleString("en-GB")} a month`,
  };
}
