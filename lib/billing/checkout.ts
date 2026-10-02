import {
  PLAN_LABELS,
  getExamPassExpiry,
  getExamPassPricePence,
  type PaidPlanId,
} from "@/lib/billing/plans";

/**
 * The Stripe Checkout session for a purchase, as form fields.
 *
 * Pure, so what is asked of Stripe can be tested without Stripe. Plans are
 * subscriptions against fixed GBP prices set up in Stripe; an Exam Pass is a
 * one-off payment priced here from the months left (docs/plans-and-stardust.md
 * §3, §5). Every session names the student by uid in three places -- the
 * reference, the session metadata and, for subscriptions, the subscription's
 * own metadata -- because the webhook is what grants the plan and must be able
 * to find them from any of the events Stripe sends.
 */

export type CheckoutKind = "subscription" | "pass";

export const CHECKOUT_WAIVER_TEXT =
  "Start now: I understand I lose my 14-day right to cancel once Jami starts.";

export function buildCheckoutSessionFields(input: {
  uid: string;
  email: string | null;
  plan: PaidPlanId;
  kind: CheckoutKind;
  priceIds: Record<PaidPlanId, string>;
  origin: string;
  now: number;
  /** Made for a parent to open and pay on their own device. */
  forParent: boolean;
}): Record<string, string> {
  const returnTo = `${input.origin}/dashboard/plans`;
  const fields: Record<string, string> = {
    client_reference_id: input.uid,
    success_url: `${returnTo}?checkout=success&plan=${input.plan}`,
    cancel_url: `${returnTo}?checkout=cancelled`,
    // UK only (doc §5): an address is required so the webhook can check it.
    billing_address_collection: "required",
    "metadata[uid]": input.uid,
    "metadata[plan]": input.plan,
    "metadata[kind]": input.kind,
    "metadata[waiverAcceptedAt]": String(input.now),
    "metadata[forParent]": input.forParent ? "true" : "false",
    locale: "en-GB",
  };
  // A parent pays with their own email; the student's would put the receipt
  // in the wrong inbox.
  if (input.email && !input.forParent) fields.customer_email = input.email;

  if (input.kind === "subscription") {
    fields.mode = "subscription";
    fields["line_items[0][price]"] = input.priceIds[input.plan];
    fields["line_items[0][quantity]"] = "1";
    fields["subscription_data[metadata][uid]"] = input.uid;
    fields["subscription_data[metadata][plan]"] = input.plan;
    return fields;
  }

  const expiresAt = getExamPassExpiry(input.now);
  const until = new Date(expiresAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  fields.mode = "payment";
  fields["line_items[0][quantity]"] = "1";
  fields["line_items[0][price_data][currency]"] = "gbp";
  fields["line_items[0][price_data][unit_amount]"] = String(
    getExamPassPricePence(input.plan, input.now)
  );
  fields["line_items[0][price_data][product_data][name]"] =
    `Jami ${PLAN_LABELS[input.plan]} Exam Pass, until ${until}`;
  fields["metadata[passExpiresAt]"] = String(expiresAt);
  fields["payment_intent_data[metadata][uid]"] = input.uid;
  return fields;
}
