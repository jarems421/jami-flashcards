import "server-only";

import { isFeatureEnabled } from "@/lib/app/feature-flags";
import {
  parseBillingLaunchAt,
  resolveEntitlement,
  type Entitlement,
  type StoredPlan,
} from "@/lib/billing/entitlement";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";

/**
 * The plan a student is on, or null while billing is switched off.
 *
 * Null means "no monthly allowances at all": the behaviour before plans
 * existed, daily limits only. Every metered route asks this through
 * `checkAiBudget`, so the account's age is cached briefly rather than read
 * from Auth on every Tutor question.
 */

const ACCOUNT_AGE_TTL_MS = 10 * 60 * 1000;
const accountCreatedAtCache = new Map<string, { value: number | null; expires: number }>();

async function readAccountCreatedAt(uid: string, now: number) {
  const cached = accountCreatedAtCache.get(uid);
  if (cached && cached.expires > now) return cached.value;
  let value: number | null = null;
  try {
    const parsed = Date.parse((await getAdminAuth().getUser(uid)).metadata.creationTime);
    value = Number.isFinite(parsed) ? parsed : null;
  } catch {
    // Unknown age resolves to Lifetime in `resolveEntitlement`: fail open.
    value = null;
  }
  accountCreatedAtCache.set(uid, { value, expires: now + ACCOUNT_AGE_TTL_MS });
  return value;
}

export function isBillingEnabled() {
  return isFeatureEnabled("enableBilling");
}

export async function getEntitlement(uid: string, now = Date.now()): Promise<Entitlement | null> {
  if (!isBillingEnabled()) return null;
  const [snapshot, accountCreatedAt] = await Promise.all([
    getAdminDb().collection("users").doc(uid).collection("billing").doc("plan").get(),
    readAccountCreatedAt(uid, now),
  ]);
  return resolveEntitlement({
    stored: snapshot.exists ? ((snapshot.data() ?? {}) as StoredPlan) : null,
    accountCreatedAt,
    launchAt: parseBillingLaunchAt(process.env.BILLING_LAUNCH_AT),
    now,
  });
}
