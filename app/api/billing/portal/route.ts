import type { NextRequest } from "next/server";
import { authenticateRequest } from "@/services/auth/authenticate-request.server";
import { createLogger } from "@/lib/observability/logger";
import { getStripeConfig, stripePost } from "@/services/billing/stripe.server";
import { getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";

/**
 * Opens Stripe's customer portal for a student paying monthly: change card,
 * switch between Nova and Celestial, or cancel. Cancelling there keeps the
 * plan to the end of the month paid for; the webhook records it.
 */
export async function POST(request: NextRequest) {
  const uid = await authenticateRequest(request);
  if (!uid) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const config = getStripeConfig();
  if (!config) {
    return Response.json(
      { error: "Payments aren't switched on yet.", code: "payments_not_configured" },
      { status: 503 }
    );
  }

  const snapshot = await getAdminDb().collection("users").doc(uid).collection("billing").doc("plan").get();
  const customer = snapshot.data()?.stripeCustomerId;
  if (typeof customer !== "string" || !customer) {
    return Response.json(
      { error: "There's no monthly plan on this account to manage.", code: "no_subscription" },
      { status: 404 }
    );
  }

  try {
    const session = await stripePost<{ url?: string }>(config, "billing_portal/sessions", {
      customer,
      return_url: `${request.nextUrl.origin}/dashboard/profile#plan`,
      locale: "en-GB",
    });
    if (!session.url) throw new Error("Stripe returned no portal link.");
    return Response.json({ url: session.url });
  } catch (error) {
    createLogger({ route: "billing.portal", uid }).error("portal.failed", { error });
    return Response.json(
      { error: "Your plan can't be managed just now. Try again shortly.", code: "portal_failed" },
      { status: 502 }
    );
  }
}
