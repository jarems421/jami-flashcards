"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CelestialBody from "@/components/billing/CelestialBody";
import { Card } from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import type { PlanSummary } from "@/lib/billing/summary";
import { CheckoutError, openBillingPortal } from "@/services/billing/checkout";
import { loadPlanSummary } from "@/services/billing/plan-summary-store";

/**
 * One quiet line about the student's plan on the Account page, with the full
 * usage a link away rather than in their face -- the way ChatGPT and Claude
 * keep usage in settings. Nothing at all while billing is switched off.
 *
 * The plan's mark sits beside its name: Jami's star for Free, Nova's and
 * Celestial's galaxies, and Celestial's for Lifetime, which has everything.
 */
const linkClass =
  "text-text-secondary underline decoration-current/30 underline-offset-4 transition hover:text-text-primary disabled:opacity-60";

export default function PlanSummaryRow() {
  const enabled = featureFlags.enableBilling;
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const monthly = summary.source === "subscription";
  const resets = summary.resetsAt
    ? new Date(summary.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })
    : null;

  const manage = async () => {
    setOpening(true);
    setError(null);
    try {
      window.location.assign(await openBillingPortal());
    } catch (reason) {
      setError(reason instanceof CheckoutError ? reason.message : "Your plan can't be managed just now.");
      setOpening(false);
    }
  };

  return (
    <Card id="plan" padding="md">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <CelestialBody plan={summary.plan === "lifetime" ? "pro" : summary.plan} size={44} framed />
          <div className="min-w-0">
            <div className="text-2xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Plan</div>
            <div className="mt-0.5 text-sm text-text-primary">
              <span className="font-semibold">{summary.label}</span>
              <span className="text-text-muted">
                {lifetime
                  ? " · free for good with no monthly limits, because you joined before plans"
                  : resets
                    ? ` · allowances reset on ${resets}`
                    : ""}
              </span>
            </div>
            {error ? <div className="mt-1 text-xs text-warm-accent">{error}</div> : null}
          </div>
        </div>
        {lifetime ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-4 pl-[3.6rem] text-xs font-semibold sm:pl-0">
            <Link href="/dashboard/profile/usage" className={linkClass}>
              View usage
            </Link>
            {monthly ? (
              <button type="button" className={linkClass} disabled={opening} onClick={() => void manage()}>
                {opening ? "Opening…" : "Manage plan"}
              </button>
            ) : null}
            {summary.plan !== "pro" ? (
              <Link href="/dashboard/plans" className={linkClass}>
                See plans
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}
