import type { PlanSummary } from "@/lib/billing/summary";
import { auth } from "@/services/firebase/client";

/** The signed-in student's plan and allowances, from the summary route. */
export async function fetchPlanSummary(): Promise<PlanSummary> {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to see your plan.");
  const response = await fetch("/api/billing/summary", {
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (PlanSummary & { error?: string })
    | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? "Your plan could not be loaded just now.");
  }
  return body;
}
