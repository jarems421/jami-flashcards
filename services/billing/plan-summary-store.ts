import type { PlanSummary } from "@/lib/billing/summary";
import { fetchPlanSummary } from "@/services/billing/summary";

/**
 * One shared copy of the student's plan summary in the browser.
 *
 * Several hints can be on screen at once -- a paper counter, the Tutor's
 * composer -- and each asking the server separately would be wasteful. They
 * share this copy, which is refetched when it is a minute old, when the window
 * comes back into focus, and straight after something was spent.
 */

const MAX_AGE_MS = 60_000;

let cached: { summary: PlanSummary; at: number } | null = null;
let inflight: Promise<PlanSummary> | null = null;
const listeners = new Set<() => void>();

export function readCachedPlanSummary() {
  return cached?.summary ?? null;
}

export async function loadPlanSummary(force = false): Promise<PlanSummary> {
  if (!force && cached && Date.now() - cached.at < MAX_AGE_MS) return cached.summary;
  if (inflight) return inflight;
  inflight = fetchPlanSummary()
    .then((summary) => {
      cached = { summary, at: Date.now() };
      return summary;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Call after an action that may have used an allowance, so any counter on
 * screen catches up instead of waiting for its minute to pass.
 */
export function notifyAllowanceSpent() {
  cached = null;
  listeners.forEach((listener) => listener());
}

export function subscribePlanSummary(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
