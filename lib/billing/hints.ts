import type { PlanSummary } from "@/lib/billing/summary";
import type { AllowanceKey } from "@/lib/billing/plans";
import { describeUpgradeFor } from "@/lib/billing/upsell";

/**
 * When a student is told about an allowance, and in what words.
 *
 * Quiet by default, the way ChatGPT and Claude handle limits: nothing is shown
 * until a student is close to running out, and then one short line where they
 * are spending it. The scarce things -- a Jami paper above all -- get a
 * Perplexity-style counter beside the button, because knowing how many are
 * left changes how a student uses them. Anything shown as unlimited is never
 * counted out loud, whatever ceiling sits behind it.
 */

export type AllowanceHintMode =
  /** Always shown beside the action: "4 of 6 Jami papers left this month". */
  | "always"
  /** Shown only near the end: "8 Tutor messages left until 14 November". */
  | "low"
  /**
   * After a success, and only once the last one is used: "Want another before
   * 14 November? Nova includes 8 Jami papers a month." The moment a student
   * has just seen what it does is the one moment an offer answers a want.
   */
  | "nudge";

/** The words for one and for several, for the allowances that ever show a hint. */
const NOUNS: Partial<Record<AllowanceKey, [string, string]>> = {
  tutor: ["Tutor message", "Tutor messages"],
  searches: ["web search", "web searches"],
  photos: ["photo", "photos"],
  answers: ["marked answer", "marked answers"],
  papers: ["Jami paper", "Jami papers"],
  paperMarkings: ["paper marking", "paper markings"],
  revisionSessions: ["Revision Session", "Revision Sessions"],
  videos: ["video import", "video imports"],
  diagramLabels: ["label find", "label finds"],
};

/**
 * How few must be left before a "low" hint appears: a fifth of the month's
 * allowance, never more than ten and never fewer than one. Ten Tutor questions
 * is enough warning to plan around; a fifth of six papers is one.
 */
export function getLowAllowanceThreshold(limit: number) {
  return Math.min(10, Math.max(1, Math.ceil(limit * 0.2)));
}

function formatDay(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

/**
 * Where a hint's quiet "See plans" link goes, or null for no link: only once
 * the line is a warning (running low, or out) and only where there is a plan
 * to move up to. A neutral count ("4 of 8 left") never carries one.
 */
export function getAllowanceHintPlansHref(input: {
  summary: PlanSummary | null;
  key: AllowanceKey;
}): string | null {
  const { summary } = input;
  if (!summary?.enabled || (summary.plan !== "free" && summary.plan !== "plus")) return null;
  const item = summary.groups.flatMap((group) => group.items).find((candidate) => candidate.key === input.key);
  if (!item || item.shown === "unlimited") return null;
  if (item.remaining > getLowAllowanceThreshold(item.limit)) return null;
  return `/dashboard/plans?for=${input.key}`;
}

export function getAllowanceHint(input: {
  summary: PlanSummary | null;
  key: AllowanceKey;
  mode: AllowanceHintMode;
}): string | null {
  const { summary } = input;
  if (!summary?.enabled || summary.plan === "lifetime") return null;
  const nouns = NOUNS[input.key];
  if (!nouns) return null;
  const item = summary.groups
    .flatMap((group) => group.items)
    .find((candidate) => candidate.key === input.key);
  if (!item || item.shown === "unlimited") return null;

  const resets = summary.resetsAt ? formatDay(summary.resetsAt) : null;
  if (input.mode === "nudge") {
    const upgrade = item.remaining === 0 ? describeUpgradeFor(summary.plan, input.key) : null;
    if (!upgrade) return null;
    return `Want another ${resets ? `before ${resets}` : "this month"}? ${upgrade}`;
  }
  if (item.remaining === 0) {
    return resets ? `No ${nouns[1]} left until ${resets}` : `No ${nouns[1]} left this month`;
  }
  const noun = item.remaining === 1 ? nouns[0] : nouns[1];
  if (input.mode === "always") {
    return `${item.remaining} of ${item.limit} ${nouns[1]} left this month`;
  }
  if (item.remaining > getLowAllowanceThreshold(item.limit)) return null;
  return resets
    ? `${item.remaining} ${noun} left until ${resets}`
    : `${item.remaining} ${noun} left this month`;
}
