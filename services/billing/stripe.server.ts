import "server-only";

import type { PaidPlanId } from "@/lib/billing/plans";
import { isBillingEnabled } from "@/services/billing/entitlements.server";

/**
 * Stripe over its REST API, without the SDK.
 *
 * The app needs four calls and a webhook signature check; the SDK would be a
 * new dependency in a repo whose worktrees share one node_modules. Each call
 * is a form-encoded POST with the secret key, which is all the SDK does.
 */

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  priceIds: Record<PaidPlanId, string>;
};

/**
 * Stripe's settings, or null if payments must not be taken yet.
 *
 * The webhook secret is required as well as the key: the webhook is what turns
 * a payment into a plan, and a checkout opened without it could take money
 * that never becomes anything. Billing itself must also be switched on.
 */
export function getStripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const plus = process.env.STRIPE_PRICE_PLUS?.trim();
  const pro = process.env.STRIPE_PRICE_PRO?.trim();
  if (!isBillingEnabled() || !secretKey || !webhookSecret || !plus || !pro) return null;
  return { secretKey, webhookSecret, priceIds: { plus, pro } };
}

export class StripeRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "StripeRequestError";
  }
}

export async function stripePost<T>(
  config: StripeConfig,
  path: string,
  fields: Record<string, string>
): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!response.ok || !body) {
    throw new StripeRequestError(body?.error?.message ?? "Stripe refused the request.", response.status);
  }
  return body;
}
