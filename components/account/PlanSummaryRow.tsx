"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import type { PlanSummary } from "@/lib/billing/summary";
import { loadPlanSummary } from "@/services/billing/plan-summary-store";

/**
 * One quiet line about the student's plan on the Account page, with the full
 * usage a link away rather than in their face -- the way ChatGPT and Claude
 * keep usage in settings. Nothing at all while billing is switched off.
 */
export default function PlanSummaryRow() {
  const enabled = featureFlags.enableBilling;
  const [summary, setSummary] = useState<PlanSummary | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadPlanSummary()
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled || !summary?.enabled) return null;

  const lifetime = summary.plan === "lifetime";
  const resets = summary.resetsAt
    ? new Date(summary.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })
    : null;

  return (
    <Card id="plan" padding="md">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
            Plan
          </div>
          <div className="mt-1 text-sm text-text-primary">
            <span className="font-semibold">{summary.label}</span>
            <span className="text-text-muted">
              {lifetime
                ? " · free for good, because you joined before plans"
                : resets
                  ? ` · allowances reset on ${resets}`
                  : ""}
            </span>
          </div>
        </div>
        {lifetime ? null : (
          <Link
            href="/dashboard/profile/usage"
            className="shrink-0 text-xs font-semibold text-text-secondary underline decoration-current/30 underline-offset-4 transition hover:text-text-primary"
          >
            View usage
          </Link>
        )}
      </div>
    </Card>
  );
}
