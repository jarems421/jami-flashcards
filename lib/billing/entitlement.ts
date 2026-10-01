import type { PlanId } from "@/lib/billing/plans";

/**
 * Which plan a student is on right now, from what is stored about them.
 *
 * Pure, so every branch can be tested; `services/billing/entitlements.server.ts`
 * reads the inputs. Everything here fails towards the student: an account
 * whose age cannot be read, or a deployment where the launch date is not set,
 * is Lifetime rather than Free (docs/plans-and-stardust.md §8). A missed write
 * must never paywall an early user.
 */

export type EntitlementSource = "lifetime" | "subscription" | "pass" | "free";

export type Entitlement = {
  plan: PlanId;
  source: EntitlementSource;
  /** What monthly allowance periods are counted from. */
  anchor: number;
};

/** The stored plan document, `users/{uid}/billing/plan`. Written only by the server. */
export type StoredPlan = {
  plan?: unknown;
  source?: unknown;
  status?: unknown;
  periodAnchor?: unknown;
  currentPeriodEnd?: unknown;
  passExpiresAt?: unknown;
};

/** Subscription states in which the plan is still the student's. */
const LIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function resolveEntitlement(input: {
  stored: StoredPlan | null;
  accountCreatedAt: number | null;
  launchAt: number | null;
  now: number;
}): Entitlement {
  const stored = input.stored;
  const storedAnchor = finiteNumber(stored?.periodAnchor);

  if (stored?.plan === "lifetime") {
    return { plan: "lifetime", source: "lifetime", anchor: storedAnchor ?? 0 };
  }

  if (stored && (stored.plan === "plus" || stored.plan === "pro")) {
    const anchor = storedAnchor ?? input.accountCreatedAt ?? input.now;
    if (stored.source === "pass") {
      const expires = finiteNumber(stored.passExpiresAt);
      if (expires !== null && expires > input.now) {
        return { plan: stored.plan, source: "pass", anchor };
      }
    } else if (stored.source === "subscription") {
      const status = typeof stored.status === "string" ? stored.status : "";
      const periodEnd = finiteNumber(stored.currentPeriodEnd);
      // A cancelled subscription keeps its plan to the end of what was paid.
      const paidThrough = periodEnd !== null && periodEnd > input.now;
      if (LIVE_SUBSCRIPTION_STATUSES.has(status) || paidThrough) {
        return { plan: stored.plan, source: "subscription", anchor };
      }
    }
  }

  // No paid plan in force. Accounts from before launch are Lifetime for good.
  if (
    input.launchAt === null ||
    input.accountCreatedAt === null ||
    input.accountCreatedAt < input.launchAt
  ) {
    return { plan: "lifetime", source: "lifetime", anchor: storedAnchor ?? 0 };
  }
  return {
    plan: "free",
    source: "free",
    anchor: storedAnchor ?? input.accountCreatedAt,
  };
}

/** Reads `BILLING_LAUNCH_AT` (an ISO date or epoch milliseconds), or null. */
export function parseBillingLaunchAt(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const asNumber = Number(trimmed);
  const parsed = Number.isFinite(asNumber) ? asNumber : Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
