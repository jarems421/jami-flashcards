import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { buildCheckoutSessionFields, type CheckoutKind } from "@/lib/billing/checkout";
import { PAID_PLAN_IDS, type PaidPlanId } from "@/lib/billing/plans";
import { createLogger } from "@/lib/observability/logger";
import { getEntitlement } from "@/services/billing/entitlements.server";
import { getStripeConfig, stripePost } from "@/services/billing/stripe.server";
import { getAdminAuth } from "@/services/firebase/admin";

export const runtime = "nodejs";

/**
 * Starts a purchase: a Stripe Checkout session for a plan or an Exam Pass.
 *
 * Refuses with `payments_not_configured` until billing is on and every Stripe
 * setting -- including the webhook that grants the plan -- is in place.
 * Requires the 14-day waiver to have been ticked (doc §5).
 */
export async function POST(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let decoded: { uid: string; email?: string };
  try {
    decoded = await getAdminAuth().verifyIdToken(token);
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const log = createLogger({ route: "billing.checkout", uid: decoded.uid });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const plan = body?.plan;
  const kind = body?.kind;
  if (
    typeof plan !== "string" ||
    !(PAID_PLAN_IDS as readonly string[]).includes(plan) ||
    (kind !== "subscription" && kind !== "pass")
  ) {
    return Response.json({ error: "Choose a plan.", code: "invalid_request" }, { status: 400 });
  }
  if (body?.waiverAccepted !== true) {
    return Response.json(
      { error: "Tick the box to start straight away.", code: "waiver_required" },
      { status: 400 }
    );
  }

  const config = getStripeConfig();
  if (!config) {
    return Response.json(
      { error: "Payments aren't switched on yet.", code: "payments_not_configured" },
      { status: 503 }
    );
  }

  const entitlement = await getEntitlement(decoded.uid);
  if (entitlement?.plan === "lifetime") {
    return Response.json(
      { error: "You have Lifetime access already, so there's nothing to buy.", code: "lifetime" },
      { status: 409 }
    );
  }
  if (entitlement?.plan === plan && kind === "subscription") {
    return Response.json({ error: "You're on this plan already.", code: "current_plan" }, { status: 409 });
  }

  try {
    const session = await stripePost<{ url?: string }>(
      config,
      "checkout/sessions",
      buildCheckoutSessionFields({
        uid: decoded.uid,
        email: decoded.email ?? null,
        plan: plan as PaidPlanId,
        kind: kind as CheckoutKind,
        priceIds: config.priceIds,
        origin: request.nextUrl.origin,
        now: Date.now(),
        forParent: body?.forParent === true,
      })
    );
    if (!session.url) throw new Error("Stripe returned no checkout link.");
    return Response.json({ url: session.url });
  } catch (error) {
    log.error("checkout.failed", { error });
    return Response.json(
      { error: "Payments are unavailable right now. Try again shortly.", code: "checkout_failed" },
      { status: 502 }
    );
  }
}
