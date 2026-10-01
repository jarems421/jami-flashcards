import type { Entitlement } from "@/lib/billing/entitlement";
import {
  ALLOWANCE_LABELS,
  PLAN_LABELS,
  getAllowance,
  type AllowanceKey,
  type AllowancePeriod,
  type AllowanceUsage,
  type PlanId,
} from "@/lib/billing/plans";

/**
 * What the Account page shows about a student's plan: the plan, when its
 * allowances reset, and how much of each is left, grouped the way a student
 * thinks about them rather than the way the server counts them.
 *
 * Pure; the summary route reads the plan and the counter and hands them here.
 */

export type PlanSummaryItem = {
  key: AllowanceKey;
  label: string;
  shown: "count" | "unlimited";
  limit: number;
  used: number;
  remaining: number;
};

export type PlanSummaryGroup = { title: string; items: PlanSummaryItem[] };

export type PlanSummary =
  | { enabled: false }
  | {
      enabled: true;
      plan: PlanId;
      label: string;
      source: Entitlement["source"];
      /** When this month's allowances reset; null for Lifetime, which has none. */
      resetsAt: number | null;
      groups: PlanSummaryGroup[];
    };

const GROUPS: Array<{ title: string; keys: AllowanceKey[] }> = [
  { title: "Tutor", keys: ["tutor", "searches", "photos", "diagrams", "pages"] },
  {
    title: "Practice and marking",
    keys: ["papers", "answers", "paperMarkings", "revisionSessions"],
  },
  {
    title: "Making study material",
    keys: ["videos", "fileCards", "filePractice", "diagramLabels", "drafts"],
  },
];

function capitalise(text: string) {
  return text.length ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

export function buildPlanSummary(input: {
  entitlement: Entitlement | null;
  usage: AllowanceUsage;
  period: AllowancePeriod | null;
}): PlanSummary {
  const { entitlement } = input;
  if (!entitlement) return { enabled: false };
  const groups =
    entitlement.plan === "lifetime"
      ? []
      : GROUPS.map((group) => ({
          title: group.title,
          items: group.keys.flatMap((key) => {
            const allowance = getAllowance(entitlement.plan, key);
            // Nothing included at all (Free's photos) is not worth a row of zeros.
            if (!allowance || allowance.limit === 0) return [];
            const used = input.usage.used[key] ?? 0;
            const limit = allowance.limit + (input.usage.extra[key] ?? 0);
            return [
              {
                key,
                label: capitalise(ALLOWANCE_LABELS[key]),
                shown: allowance.shown,
                limit,
                used: Math.min(used, limit),
                remaining: Math.max(0, limit - used),
              },
            ];
          }),
        })).filter((group) => group.items.length > 0);
  return {
    enabled: true,
    plan: entitlement.plan,
    label: PLAN_LABELS[entitlement.plan],
    source: entitlement.source,
    resetsAt: entitlement.plan === "lifetime" ? null : input.period?.end ?? null,
    groups,
  };
}
