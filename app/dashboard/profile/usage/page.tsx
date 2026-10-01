"use client";

import { notFound } from "next/navigation";
import AppPage from "@/components/layout/AppPage";
import PlanUsageDetails from "@/components/account/PlanUsageDetails";
import { featureFlags } from "@/lib/app/feature-flags";

/**
 * Usage, kept off the Account page on purpose: reached from the small "View
 * usage" link beside the plan, not from a tab or the sidebar.
 */
export default function AccountUsagePage() {
  if (!featureFlags.enableBilling) notFound();
  return (
    <AppPage
      title="Usage"
      backHref="/dashboard/profile"
      backLabel="Account"
      width="2xl"
      contentClassName="space-y-4 sm:space-y-6"
    >
      <PlanUsageDetails />
    </AppPage>
  );
}
