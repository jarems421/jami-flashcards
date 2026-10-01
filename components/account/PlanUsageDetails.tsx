"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, ProgressBar, SectionHeader } from "@/components/ui";
import Skeleton from "@/components/ui/Skeleton";
import type { PlanSummary, PlanSummaryItem } from "@/lib/billing/summary";
import { loadPlanSummary } from "@/services/billing/plan-summary-store";

/**
 * The full usage view, a link away from Account.
 *
 * Only what is actually counted is listed. Everything shown as unlimited is
 * one sentence, never a row with a number beside it: its ceiling exists to
 * stop abuse, not to be watched.
 */
export default function PlanUsageDetails() {
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPlanSummary(true)
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Your usage could not be loaded just now.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Card padding="lg">
        <p className="text-sm text-text-muted">{error}</p>
      </Card>
    );
  }
  if (!summary) {
    return (
      <Card padding="lg">
        <div aria-busy="true" aria-label="Loading your usage" className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-28 w-full" />
        </div>
      </Card>
    );
  }
  if (!summary.enabled || summary.plan === "lifetime") {
    return (
      <Card padding="lg">
        <SectionHeader
          eyebrow="Usage"
          title={summary.enabled ? "Lifetime" : "No limits to show"}
          description="Nothing is counted month to month on your account."
        />
      </Card>
    );
  }

  const resets = summary.resetsAt
    ? new Date(summary.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })
    : null;
  const counted = summary.groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.shown === "count") }))
    .filter((group) => group.items.length > 0);

  return (
    <Card padding="lg">
      <SectionHeader
        eyebrow="Usage this month"
        title={summary.label}
        description={resets ? `Your allowances reset on ${resets}.` : undefined}
      />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {counted.map((group) => (
          <section key={group.title} aria-label={group.title} className="app-subtle-panel min-w-0 rounded-xl p-4">
            <h4 className="text-2xs font-semibold uppercase tracking-[0.16em] text-text-secondary">
              {group.title}
            </h4>
            <ul className="mt-3 space-y-3.5">
              {group.items.map((item) => (
                <UsageRow key={item.key} item={item} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-5 text-xs leading-5 text-text-muted">
        Everything else — flashcards and practice questions from your files, card drafts, deck
        preparation, answer checks, planner chats and Tutor diagrams — is unlimited for normal
        studying.
      </p>
      {summary.plan !== "pro" ? (
        <p className="mt-3 text-xs">
          <Link
            href="/dashboard/plans"
            className="font-semibold text-text-secondary underline decoration-current/30 underline-offset-4 transition hover:text-text-primary"
          >
            See plans
          </Link>
        </p>
      ) : null}
    </Card>
  );
}

function UsageRow({ item }: { item: PlanSummaryItem }) {
  const out = item.remaining === 0;
  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-text-primary">{item.label}</span>
        <span className={`shrink-0 text-xs tabular-nums ${out ? "text-warm-accent" : "text-text-muted"}`}>
          {out
            ? "None left"
            : `${item.remaining.toLocaleString("en-GB")} of ${item.limit.toLocaleString("en-GB")} left`}
        </span>
      </div>
      <ProgressBar
        progress={item.limit > 0 ? (item.used / item.limit) * 100 : 100}
        size="sm"
        variant={out ? "warm" : "accent"}
        className="mt-1.5"
      />
    </li>
  );
}
