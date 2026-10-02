import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { StripeAction } from "@/lib/billing/stripe-events";
import { createLogger } from "@/lib/observability/logger";
import { stripeDelete, stripeGet, stripePost, type StripeConfig } from "@/services/billing/stripe.server";
import { getAdminDb } from "@/services/firebase/admin";

/**
 * Turns verified Stripe events into plans.
 *
 * The plan document is the only thing written, inside a transaction, and an
 * event older than the last one applied is skipped: Stripe does not promise
 * order, and a late "updated" must not undo a "deleted".
 */

const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Stripe's webhook signature: `t=<seconds>,v1=<hex hmac>` over
 * `<t>.<raw body>` with the endpoint's secret. Rejects anything older than
 * five minutes so a captured request cannot be replayed later.
 */
export function verifyStripeSignature(input: {
  payload: string;
  header: string | null;
  secret: string;
  now?: number;
}): boolean {
  if (!input.header) return false;
  const parts = input.header.split(",").map((part) => part.trim().split("="));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value ?? "");
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(
    createHmac("sha256", input.secret).update(`${timestamp}.${input.payload}`).digest("hex"),
    "utf8"
  );
  return signatures.some((signature) => {
    const supplied = Buffer.from(signature, "utf8");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

function planRef(uid: string) {
  return getAdminDb().collection("users").doc(uid).collection("billing").doc("plan");
}

/** Writes a granted plan, unless a newer event already has. */
async function grant(action: Extract<StripeAction, { type: "grant" }>, eventAt: number) {
  const ref = planRef(action.uid);
  return getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const stored = (snapshot.data() ?? {}) as Record<string, unknown>;
    const lastEventAt = typeof stored.lastEventAt === "number" ? stored.lastEventAt : 0;
    if (lastEventAt > eventAt) return "stale" as const;
    if (stored.plan === "lifetime") return "lifetime" as const;

    // A live Exam Pass outranks events about some other, older subscription.
    const livePass =
      stored.source === "pass" &&
      typeof stored.passExpiresAt === "number" &&
      stored.passExpiresAt > eventAt;
    if (
      livePass &&
      action.fields.source === "subscription" &&
      stored.stripeSubscriptionId !== action.fields.stripeSubscriptionId
    ) {
      return "pass-kept" as const;
    }

    const anchor =
      action.newPurchase || typeof stored.periodAnchor !== "number" ? eventAt : stored.periodAnchor;
    transaction.set(
      ref,
      {
        ...action.fields,
        // A pass written over a subscription, or the reverse, must not leave the
        // other's dates behind to be misread.
        ...(action.fields.source === "pass"
          ? { currentPeriodEnd: null, cancelAtPeriodEnd: false }
          : { passExpiresAt: null }),
        periodAnchor: anchor,
        lastEventAt: eventAt,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    return "granted" as const;
  });
}

/** Ends a pass now, after Stripe refunded it in full. Only ever touches a pass. */
async function revokePass(uid: string, eventAt: number) {
  const ref = planRef(uid);
  return getAdminDb().runTransaction(async (transaction) => {
    const stored = ((await transaction.get(ref)).data() ?? {}) as Record<string, unknown>;
    if (stored.source !== "pass") return "not-a-pass" as const;
    transaction.set(
      ref,
      { status: "refunded", passExpiresAt: eventAt, lastEventAt: eventAt, updatedAt: Date.now() },
      { merge: true }
    );
    return "revoked" as const;
  });
}

/**
 * A purchase from outside the UK: refund it, end any subscription, grant
 * nothing. Recorded under the event's id once done, so a redelivered event
 * does not try to refund the same payment twice.
 */
async function refuseCountry(
  config: StripeConfig,
  action: Extract<StripeAction, { type: "refuse-country" }>,
  eventId: string | null
) {
  const done = eventId ? getAdminDb().collection("stripeEvents").doc(eventId) : null;
  if (done && (await done.get()).exists) return;
  if (action.subscriptionId) {
    await stripeDelete(config, `subscriptions/${encodeURIComponent(action.subscriptionId)}`);
  }
  let paymentIntent = action.paymentIntentId;
  if (!paymentIntent && action.invoiceId) {
    const invoice = await stripeGet<{ payment_intent?: string | null }>(
      config,
      `invoices/${encodeURIComponent(action.invoiceId)}`
    );
    paymentIntent = invoice.payment_intent ?? null;
  }
  if (paymentIntent) {
    await stripePost(config, "refunds", { payment_intent: paymentIntent, reason: "requested_by_customer" });
  }
  await done?.set({ type: "refuse-country", uid: action.uid, at: Date.now() });
}

export async function applyStripeAction(
  config: StripeConfig,
  action: StripeAction,
  eventAt: number,
  eventId: string | null = null
) {
  const log = createLogger({ route: "billing.webhook" });
  if (action.type === "ignore") return { outcome: "ignored" as const, reason: action.reason };
  if (action.type === "refuse-country") {
    await refuseCountry(config, action, eventId);
    log.warn("billing.refused_country", { uid: action.uid, country: action.country });
    return { outcome: "refunded" as const };
  }
  if (action.type === "revoke-pass") {
    const outcome = await revokePass(action.uid, eventAt);
    log.info("billing.pass_refunded", { uid: action.uid, outcome });
    return { outcome };
  }
  // The plan is read fresh on every request (entitlements.server.ts), so the
  // next Tutor question already counts against it.
  const outcome = await grant(action, eventAt);
  log.info("billing.plan_written", { uid: action.uid, outcome, plan: action.fields.plan, source: action.fields.source });
  return { outcome };
}
