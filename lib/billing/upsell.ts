import {
  ALLOWANCE_KEYS,
  ALLOWANCE_LABELS,
  EXAM_PASS_DISCOUNT,
  PLAN_ALLOWANCES,
  PLAN_LABELS,
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

/** After "Not now", the sheet stays away this long, whatever runs out next. */
export const PLANS_SHEET_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Whether running out of something should open the plans sheet.
 *
 * In-app research is consistent: a prompt converts when it answers a limit
 * the student just hit, and annoys when it repeats. So the sheet appears only
 * at a wall, at most once a session whatever ran out, and not at all for
 * three days after a "Not now". Every later wall gets its inline message and
 * reset date alone. Pro has nothing to move up to and never sees it.
 */
export function shouldOfferPlans(input: {
  plan: PlanId | null;
  /** Sheets already shown this session. */
  alreadyOffered: ReadonlySet<string>;
  /** When the student last chose "Not now", if ever. */
  dismissedAt?: number | null;
  now?: number;
}) {
  if (!input.plan || !suggestedUpgrade(input.plan)) return false;
  if (input.alreadyOffered.size > 0) return false;
  if (input.dismissedAt && (input.now ?? Date.now()) - input.dismissedAt < PLANS_SHEET_COOLDOWN_MS) {
    return false;
  }
  return true;
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
  const name = PLAN_LABELS[next];
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

/**
 * A monthly price as a daily one ("about 26p a day"). Spreading a price over
 * the days it covers makes it comparable with small everyday spending
 * (Gourville 1998, "Pennies-a-Day"), which suits something used daily like
 * revision. Shown small, beside the real price, never instead of it.
 */
export function perDayPence(monthlyPence: number) {
  return Math.round((monthlyPence * 12) / 365);
}

/**
 * What an hour with a private GCSE tutor costs in the UK, as a value anchor:
 * about £38 (TutorCruncher, "Average tutoring rates UK: 2026"; A-level is
 * nearer £52). Kept as the lower, GCSE figure so the comparison never flatters.
 */
export const TUTOR_HOUR_PENCE = 3800;

const WEEKS_PER_MONTH = 52 / 12;

/**
 * A monthly allowance as the pace a student would actually use it at: "nearly
 * 3 a week" reads as a revision routine where "12 a month" is just a number.
 * Daily for things used many times a day, weekly otherwise; null where a pace
 * would say nothing ("1 a month", unlimited, not included).
 */
export function describeAllowancePace(plan: Exclude<PlanId, "lifetime">, key: AllowanceKey) {
  const allowance = PLAN_ALLOWANCES[plan][key];
  if (allowance.shown === "unlimited" || allowance.limit < 2) return null;
  const perDay = allowance.limit / 30;
  if (perDay >= 2) return `about ${Math.round(perDay)} a day`;
  const perWeek = allowance.limit / WEEKS_PER_MONTH;
  if (perWeek < 1) return null;
  const whole = Math.floor(perWeek);
  const part = perWeek - whole;
  if (part >= 0.7) return `nearly ${whole + 1} a week`;
  if (part <= 0.3) return whole === 1 ? "about one a week" : `about ${whole} a week`;
  return `${whole} to ${whole + 1} a week`;
}
