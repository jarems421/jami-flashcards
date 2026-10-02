import type { NextRequest } from "next/server";
import { interpretStripeEvent } from "@/lib/billing/stripe-events";
import { createLogger } from "@/lib/observability/logger";
import { getStripeConfig } from "@/services/billing/stripe.server";
import { applyStripeAction, verifyStripeSignature } from "@/services/billing/stripe-webhook.server";

export const runtime = "nodejs";

/**
 * Stripe's webhook: the one way a payment becomes a plan.
 *
 * The raw body is verified against `STRIPE_WEBHOOK_SECRET` before anything is
 * read from it. Anything Jami does not act on is acknowledged and ignored. A
 * failure while writing returns 500, so Stripe retries the event.
 */
export async function POST(request: NextRequest) {
  const log = createLogger({ route: "billing.webhook" });
  const config = getStripeConfig();
  if (!config) return Response.json({ error: "Payments aren't switched on." }, { status: 503 });

  const payload = await request.text();
  if (
    !verifyStripeSignature({
      payload,
      header: request.headers.get("stripe-signature"),
      secret: config.webhookSecret,
    })
  ) {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  let event: { id?: string; type?: string; created?: number };
  try {
    event = JSON.parse(payload) as typeof event;
  } catch {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }

  const action = interpretStripeEvent(event, { priceIds: config.priceIds });
  const eventAt = typeof event.created === "number" ? event.created * 1000 : Date.now();
  try {
    const result = await applyStripeAction(config, action, eventAt, typeof event.id === "string" ? event.id : null);
    return Response.json({ received: true, ...result });
  } catch (error) {
    log.error("billing.webhook_failed", { error, eventId: event.id, type: event.type });
    return Response.json({ error: "Could not apply the event." }, { status: 500 });
  }
}
