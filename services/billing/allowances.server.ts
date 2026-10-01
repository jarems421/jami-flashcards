import "server-only";

import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { Entitlement } from "@/lib/billing/entitlement";
import {
  ALLOWANCE_KEYS,
  decideAllowance,
  describeAllowanceRefusal,
  getAllowance,
  getAllowancePeriod,
  type AllowanceKey,
  type AllowancePeriod,
  type AllowanceUsage,
} from "@/lib/billing/plans";
import { getEntitlement } from "@/services/billing/entitlements.server";
import { getAdminDb } from "@/services/firebase/admin";

/**
 * Monthly allowance counters, `users/{uid}/allowanceUsage/{periodKey}`.
 *
 * Written only by the server, inside the same transaction that allows the
 * request, so two requests arriving together cannot both take the last one.
 * Most allowances are charged through `checkAiBudget`; the few that are only
 * known part-way through a request -- a web search, a generated photo, the
 * pages a source turned out to have -- use `chargeAllowance` and
 * `recordAllowanceUsage` here.
 */

export function allowanceUsageRef(db: Firestore, uid: string, periodKey: string) {
  return db.doc(`users/${uid}/allowanceUsage/${periodKey}`);
}

function countsFrom(value: unknown) {
  const counts: Partial<Record<AllowanceKey, number>> = {};
  if (!value || typeof value !== "object") return counts;
  for (const key of ALLOWANCE_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) counts[key] = Math.floor(raw);
  }
  return counts;
}

export function readAllowanceUsage(data: Record<string, unknown> | undefined): AllowanceUsage {
  return { used: countsFrom(data?.used), extra: countsFrom(data?.extra) };
}

/** What the allowance check needs, or null when this request has no monthly limit. */
export type AllowanceContext = {
  entitlement: Entitlement;
  key: AllowanceKey;
  amount: number;
  period: AllowancePeriod;
};

export async function resolveAllowanceContext(input: {
  uid: string;
  key: AllowanceKey | null;
  amount?: number;
  now: number;
}): Promise<AllowanceContext | null> {
  if (!input.key) return null;
  const entitlement = await getEntitlement(input.uid, input.now);
  if (!entitlement || !getAllowance(entitlement.plan, input.key)) return null;
  return {
    entitlement,
    key: input.key,
    amount: Math.max(0, Math.floor(input.amount ?? 1)),
    period: getAllowancePeriod(entitlement.anchor, input.now),
  };
}

export type AllowanceRefusal = { retryAfterSeconds: number; message: string };

/**
 * Reads the counter inside `transaction` and decides. Call before any write in
 * the transaction; apply the returned `write` only once every check passed.
 */
export async function checkAllowanceInTransaction(input: {
  transaction: Transaction;
  db: Firestore;
  uid: string;
  context: AllowanceContext;
  now: number;
}): Promise<{ refusal: AllowanceRefusal } | { refusal: null; write: () => void }> {
  const { context } = input;
  const ref = allowanceUsageRef(input.db, input.uid, context.period.key);
  const usage = readAllowanceUsage((await input.transaction.get(ref)).data());
  const decision = decideAllowance({
    plan: context.entitlement.plan,
    key: context.key,
    usage,
    amount: context.amount,
  });
  if (!decision.allowed) {
    return {
      refusal: {
        retryAfterSeconds: Math.max(1, Math.ceil((context.period.end - input.now) / 1000)),
        message: describeAllowanceRefusal({
          plan: context.entitlement.plan,
          key: context.key,
          periodEnd: context.period.end,
        }),
      },
    };
  }
  return {
    refusal: null,
    write: () => {
      if (context.amount <= 0) return;
      input.transaction.set(
        ref,
        {
          used: { ...usage.used, [context.key]: (usage.used[context.key] ?? 0) + context.amount },
          plan: context.entitlement.plan,
          periodStart: context.period.start,
          periodEnd: context.period.end,
          updatedAt: input.now,
        },
        { merge: true }
      );
    },
  };
}

/** Gives back what a failed request was charged. Never below zero. */
export async function refundAllowanceInTransaction(input: {
  transaction: Transaction;
  db: Firestore;
  uid: string;
  allowance: { periodKey: string; key: AllowanceKey; amount: number };
}) {
  const ref = allowanceUsageRef(input.db, input.uid, input.allowance.periodKey);
  const usage = readAllowanceUsage((await input.transaction.get(ref)).data());
  const used = usage.used[input.allowance.key] ?? 0;
  if (used <= 0) return () => undefined;
  return () =>
    input.transaction.set(
      ref,
      {
        used: { ...usage.used, [input.allowance.key]: Math.max(0, used - input.allowance.amount) },
        updatedAt: Date.now(),
      },
      { merge: true }
    );
}

export type AllowanceCharge =
  | { allowed: true; refund: () => Promise<void> }
  | ({ allowed: false } & AllowanceRefusal);

/**
 * Charges one allowance on its own, for spending that happens part-way
 * through a request already allowed: a Tutor web search, a generated photo.
 */
export async function chargeAllowance(input: {
  uid: string;
  key: AllowanceKey;
  amount?: number;
  now?: number;
}): Promise<AllowanceCharge> {
  const now = input.now ?? Date.now();
  const context = await resolveAllowanceContext({ ...input, now });
  if (!context) return { allowed: true, refund: async () => undefined };
  const db = getAdminDb();
  const result = await db.runTransaction(async (transaction) => {
    const checked = await checkAllowanceInTransaction({ transaction, db, uid: input.uid, context, now });
    if (checked.refusal) return checked.refusal;
    checked.write();
    return null;
  });
  if (result) return { allowed: false, ...result };
  const allowance = { periodKey: context.period.key, key: context.key, amount: context.amount };
  return {
    allowed: true,
    refund: async () => {
      await db.runTransaction(async (transaction) => {
        (await refundAllowanceInTransaction({ transaction, db, uid: input.uid, allowance }))();
      });
    },
  };
}

/**
 * Adds usage measured after the work was done -- the pages a source turned
 * out to have -- without refusing anything. The request was already allowed
 * on the strength of there being some allowance left.
 */
export async function recordAllowanceUsage(input: {
  uid: string;
  key: AllowanceKey;
  amount: number;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const context = await resolveAllowanceContext({ ...input, now });
  if (!context || context.amount <= 0) return;
  const db = getAdminDb();
  await db.runTransaction(async (transaction) => {
    const ref = allowanceUsageRef(db, input.uid, context.period.key);
    const usage = readAllowanceUsage((await transaction.get(ref)).data());
    transaction.set(
      ref,
      {
        used: { ...usage.used, [context.key]: (usage.used[context.key] ?? 0) + context.amount },
        plan: context.entitlement.plan,
        periodStart: context.period.start,
        periodEnd: context.period.end,
        updatedAt: now,
      },
      { merge: true }
    );
  });
}
