"use client";

import { useEffect, useState } from "react";
import { Card, ProgressBar, SectionHeader } from "@/components/ui";
import Skeleton from "@/components/ui/Skeleton";
import { featureFlags } from "@/lib/app/feature-flags";
import type { PlanSummary, PlanSummaryItem } from "@/lib/billing/summary";
import { fetchPlanSummary } from "@/services/billing/summary";

/**
 * The student's plan on the Account page: what they are on, when this month's
 * allowances reset, and how much of each is left.
 *
 * Shows nothing at all while billing is switched off, so plans stay invisible
 * until they exist. Lifetime accounts -- everyone who joined before plans --
 * get a thank-you instead of rows of numbers, because nothing is counted.
 */
export default function PlanAllowancesCard() {
  const enabled = featureFlags.enableBilling;
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchPlanSummary()
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Your plan could not be loaded just now.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled || summary?.enabled === false) return null;

  return (
    <Card id="plan" padding="lg">
      {error ? (
        <>
          <SectionHeader eyebrow="Plan" title="Your plan" />
          <p className="mt-4 text-sm text-text-muted">{error}</p>
        </>
      ) : !summary ? (
        <div aria-busy="true" aria-label="Loading your plan" className="space-y-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-4 h-24 w-full" />
        </div>
      ) : (
        <PlanBody summary={summary} />
      )}
    </Card>
  );
}

function PlanBody({ summary }: { summary: Extract<PlanSummary, { enabled: true }> }) {
  if (summary.plan === "lifetime") {
    return (
      <SectionHeader
        eyebrow="Plan"
        title="Lifetime"
        description="You joined Jami before plans existed, so it stays free for you, for good. Nothing is counted month to month."
      />
    );
  }

  const resets = summary.resetsAt
    ? new Date(summary.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })
    : null;

  return (
    <>
      <SectionHeader
        eyebrow="Plan"
        title={summary.label}
        description={
          resets
            ? `What's included each month. Your allowances reset on ${resets}.`
            : "What's included each month."
        }
      />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {summary.groups.map((group) => (
          <section
            key={group.title}
            aria-label={group.title}
            className="app-subtle-panel min-w-0 rounded-xl p-4"
          >
            <h4 className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
              {group.title}
            </h4>
            <ul className="mt-3 space-y-3.5">
              {group.items.map((item) => (
                <AllowanceRow key={item.key} item={item} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function AllowanceRow({ item }: { item: PlanSummaryItem }) {
  if (item.shown === "unlimited") {
    return (
      <li className="flex min-w-0 items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-text-primary">{item.label}</span>
        <span className="app-chip shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold">
          Unlimited
        </span>
      </li>
    );
  }
  const usedShare = item.limit > 0 ? (item.used / item.limit) * 100 : 100;
  const out = item.remaining === 0;
  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-text-primary">{item.label}</span>
        <span className={`shrink-0 text-xs tabular-nums ${out ? "text-warm-accent" : "text-text-muted"}`}>
          {out ? "None left" : `${item.remaining.toLocaleString("en-GB")} of ${item.limit.toLocaleString("en-GB")} left`}
        </span>
      </div>
      <ProgressBar progress={usedShare} size="sm" variant={out ? "warm" : "accent"} className="mt-1.5" />
    </li>
  );
}
