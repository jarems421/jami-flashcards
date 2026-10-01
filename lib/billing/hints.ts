import type { PlanSummary } from "@/lib/billing/summary";
import type { AllowanceKey } from "@/lib/billing/plans";

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
  /** Shown only near the end: "8 Tutor questions left until 14 November". */
  | "low";

/** The words for one and for several, for the allowances that ever show a hint. */
const NOUNS: Partial<Record<AllowanceKey, [string, string]>> = {
  tutor: ["Tutor question", "Tutor questions"],
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
