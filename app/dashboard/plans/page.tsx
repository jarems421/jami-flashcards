"use client";

import { notFound, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppPage from "@/components/layout/AppPage";
import PlansView from "@/components/billing/PlansView";
import { featureFlags } from "@/lib/app/feature-flags";
import { ALLOWANCE_KEYS, PAID_PLAN_IDS, type AllowanceKey, type PaidPlanId } from "@/lib/billing/plans";

function PlansContent() {
  const search = useSearchParams();
  const requested = search.get("for");
  const highlight =
    requested && (ALLOWANCE_KEYS as readonly string[]).includes(requested)
      ? (requested as AllowanceKey)
      : null;
  const bought = search.get("plan");
  const welcomePlan =
    bought && (PAID_PLAN_IDS as readonly string[]).includes(bought) ? (bought as PaidPlanId) : null;
  return (
    <PlansView
      highlight={highlight}
      checkoutSucceeded={search.get("checkout") === "success"}
      welcomePlan={welcomePlan}
    />
  );
}

/**
 * Plans. Not in the sidebar on purpose: reached from "See plans" after
 * running out of something, from the plan row on Account, or from Usage.
 */
export default function PlansPage() {
  if (!featureFlags.enableBilling) notFound();
  return (
    <AppPage
      title="Plans"
      backHref="/dashboard/profile"
      backLabel="Account"
      width="2xl"
      contentClassName="space-y-6"
    >
      <Suspense fallback={null}>
        <PlansContent />
      </Suspense>
    </AppPage>
  );
}
