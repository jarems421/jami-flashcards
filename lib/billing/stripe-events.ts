import { PAID_PLAN_IDS, type PaidPlanId } from "@/lib/billing/plans";

/**
 * What a Stripe webhook event means for a student's plan.
 *
 * Pure, so every event Jami acts on can be tested without Stripe. The webhook
 * route verifies the signature, asks this what to do, and
 * `services/billing/stripe-webhook.server.ts` does it. Only three things ever
 * change a plan:
 *
 * - a completed Checkout (a new monthly plan or an Exam Pass),
 * - a subscription changing (renewed, switched between Nova and Celestial in
 *   the portal, set to cancel, past due),
 * - a subscription ending,
 * - an Exam Pass refunded in full from the Stripe dashboard (it ends then).
 *
 * UK only (docs/plans-and-stardust.md §1): a Checkout paid from a billing
 * address outside the UK is not granted; the server refunds it instead.
 */

/** Pinned so the shapes read below cannot change under us when Stripe moves on. */
export const STRIPE_API_VERSION = "2024-06-20";

/** The plan fields a webhook writes to `users/{uid}/billing/plan`. */
export type PlanFields = {
  plan: PaidPlanId;
  source: "subscription" | "pass";
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
  passExpiresAt?: number | null;
};

export type StripeAction =
  | {
      type: "grant";
      uid: string;
      fields: PlanFields;
      /** A new purchase starts a fresh allowance month; a renewal keeps the old one. */
      newPurchase: boolean;
    }
  | {
      type: "refuse-country";
      uid: string;
      country: string | null;
      paymentIntentId: string | null;
      subscriptionId: string | null;
      invoiceId: string | null;
    }
  | { type: "revoke-pass"; uid: string }
  | { type: "ignore"; reason: string };

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Stripe ids arrive either as a string or, when expanded, as an object with an id. */
function idOf(value: unknown): string | null {
  return text(value) ?? text(record(value).id);
}

function paidPlan(value: unknown): PaidPlanId | null {
  return typeof value === "string" && (PAID_PLAN_IDS as readonly string[]).includes(value)
    ? (value as PaidPlanId)
    : null;
}

export function planFromPriceId(priceIds: Record<PaidPlanId, string>, priceId: string | null): PaidPlanId | null {
  if (!priceId) return null;
  return (Object.keys(priceIds) as PaidPlanId[]).find((plan) => priceIds[plan] === priceId) ?? null;
}

function secondsToMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value * 1000 : null;
}

export function interpretStripeEvent(
  event: unknown,
  options: { priceIds: Record<PaidPlanId, string> }
): StripeAction {
  const type = text(record(event).type);
  const object = record(record(record(event).data).object);

  if (type === "checkout.session.completed") {
    const metadata = record(object.metadata);
    const uid = text(object.client_reference_id) ?? text(metadata.uid);
    const plan = paidPlan(metadata.plan);
    if (!uid || !plan) return { type: "ignore", reason: "checkout without a Jami student or plan" };
    const country = text(record(record(object.customer_details).address).country);
    if (country && country !== "GB") {
      return {
        type: "refuse-country",
        uid,
        country,
        paymentIntentId: idOf(object.payment_intent),
        subscriptionId: idOf(object.subscription),
        invoiceId: idOf(object.invoice),
      };
    }
    const customer = idOf(object.customer);
    if (object.mode === "payment") {
      if (object.payment_status !== "paid") return { type: "ignore", reason: "pass not paid yet" };
      const expires = Number(metadata.passExpiresAt);
      if (!Number.isFinite(expires)) return { type: "ignore", reason: "pass without an end date" };
      return {
        type: "grant",
        uid,
        newPurchase: true,
        fields: { plan, source: "pass", status: "paid", stripeCustomerId: customer, passExpiresAt: expires },
      };
    }
    if (object.mode === "subscription") {
      return {
        type: "grant",
        uid,
        newPurchase: true,
        fields: {
          plan,
          source: "subscription",
          status: "active",
          stripeCustomerId: customer,
          stripeSubscriptionId: idOf(object.subscription),
        },
      };
    }
    return { type: "ignore", reason: "checkout of another kind" };
  }

  if (
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated" ||
    type === "customer.subscription.deleted"
  ) {
    const metadata = record(object.metadata);
    const uid = text(metadata.uid);
    if (!uid) return { type: "ignore", reason: "subscription without a Jami student" };
    const items = record(object.items).data;
    const firstItem = record(Array.isArray(items) ? items[0] : null);
    const plan = planFromPriceId(options.priceIds, idOf(record(firstItem.price))) ?? paidPlan(metadata.plan);
    if (!plan) return { type: "ignore", reason: "subscription to an unknown price" };
    const ended = type === "customer.subscription.deleted";
    // An ended subscription is paid through the moment it ended, not the period
    // it was in: one cancelled straight away must not keep its plan for a month.
    const periodEnd = ended
      ? secondsToMs(object.ended_at) ?? secondsToMs(object.canceled_at) ?? secondsToMs(object.current_period_end)
      : secondsToMs(object.current_period_end);
    return {
      type: "grant",
      uid,
      newPurchase: false,
      fields: {
        plan,
        source: "subscription",
        status: ended ? "canceled" : text(object.status) ?? "active",
        stripeCustomerId: idOf(object.customer),
        stripeSubscriptionId: idOf(object.id),
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: object.cancel_at_period_end === true,
      },
    };
  }

  if (type === "charge.refunded") {
    // Passes are one-off payments with the student on the payment's metadata;
    // a subscription's charges carry an invoice and are left to its own events.
    const uid = text(record(object.metadata).uid);
    if (!uid || object.refunded !== true || idOf(object.invoice)) {
      return { type: "ignore", reason: "not a fully refunded pass" };
    }
    return { type: "revoke-pass", uid };
  }

  return { type: "ignore", reason: `not handled: ${type ?? "unknown"}` };
}
