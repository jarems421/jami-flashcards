"use client";

import { useEffect, useState } from "react";
import { featureFlags } from "@/lib/app/feature-flags";
import { getAllowanceHint, type AllowanceHintMode } from "@/lib/billing/hints";
import type { AllowanceKey } from "@/lib/billing/plans";
import type { PlanSummary } from "@/lib/billing/summary";
import {
  loadPlanSummary,
  readCachedPlanSummary,
  subscribePlanSummary,
} from "@/services/billing/plan-summary-store";

/**
 * The line to show about one allowance where it is spent, or null for none --
 * which is almost always. See `lib/billing/hints.ts` for when a line appears.
 */
export function useAllowanceHint(key: AllowanceKey, mode: AllowanceHintMode) {
  const enabled = featureFlags.enableBilling;
  const [summary, setSummary] = useState<PlanSummary | null>(() =>
    enabled ? readCachedPlanSummary() : null
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = (force: boolean) => {
      loadPlanSummary(force)
        .then((next) => {
          if (!cancelled) setSummary(next);
        })
        // A hint is a courtesy; failing to load one must never show an error.
        .catch(() => undefined);
    };
    load(false);
    const unsubscribe = subscribePlanSummary(() => load(true));
    const handleFocus = () => load(false);
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
  }, [enabled]);

  return enabled ? getAllowanceHint({ summary, key, mode }) : null;
}
