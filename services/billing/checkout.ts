import type { CheckoutKind } from "@/lib/billing/checkout";
import type { PaidPlanId } from "@/lib/billing/plans";
import { auth } from "@/services/firebase/client";

export class CheckoutError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = "CheckoutError";
  }
}

/** Opens a Stripe Checkout for a plan or an Exam Pass and returns its link. */
export async function startCheckout(input: {
  plan: PaidPlanId;
  kind: CheckoutKind;
  waiverAccepted: boolean;
  forParent?: boolean;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new CheckoutError("Sign in again to choose a plan.", null);
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as
    | { url?: string; error?: string; code?: string }
    | null;
  if (!response.ok || !body?.url) {
    throw new CheckoutError(
      body?.error ?? "Payments are unavailable right now. Try again shortly.",
      body?.code ?? null
    );
  }
  return body.url;
}

/**
 * Opens Stripe's page for managing a monthly plan -- change card, switch
 * between Nova and Celestial, cancel -- and returns its link.
 */
export async function openBillingPortal(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new CheckoutError("Sign in again to manage your plan.", null);
  const response = await fetch("/api/billing/portal", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  const body = (await response.json().catch(() => null)) as
    | { url?: string; error?: string; code?: string }
    | null;
  if (!response.ok || !body?.url) {
    throw new CheckoutError(
      body?.error ?? "Your plan can't be managed just now. Try again shortly.",
      body?.code ?? null
    );
  }
  return body.url;
}
