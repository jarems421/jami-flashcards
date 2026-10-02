import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { interpretStripeEvent, planFromPriceId } from "@/lib/billing/stripe-events";

/*
 * Stripe's webhook: what each event means for a plan, that only Stripe can
 * send one, and what lands in `users/{uid}/billing/plan`.
 */

type StripeCall = (...args: unknown[]) => Promise<Record<string, unknown>>;

const mocks = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  const ref = (path: string) => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    get: async () => ({ data: () => store.get(path), exists: store.has(path) }),
    set: async (value: Record<string, unknown>) => {
      store.set(path, value);
    },
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async <T>(
      run: (transaction: {
        get: (target: { path: string }) => Promise<{ data: () => Record<string, unknown> | undefined }>;
        set: (target: { path: string }, value: Record<string, unknown>, options?: { merge?: boolean }) => void;
      }) => Promise<T>
    ) =>
      run({
        get: async (target) => ({ data: () => store.get(target.path) }),
        set: (target, value, options) =>
          store.set(target.path, options?.merge ? { ...store.get(target.path), ...value } : value),
      }),
  };
  return {
    store,
    db,
    config: { secretKey: "sk", webhookSecret: "whsec_test", priceIds: { plus: "price_plus", pro: "price_pro" } } as
      | null
      | { secretKey: string; webhookSecret: string; priceIds: { plus: string; pro: string } },
    stripePost: vi.fn<StripeCall>(async () => ({ url: "https://billing.stripe.com/p/session" })),
    stripeGet: vi.fn<StripeCall>(async () => ({ payment_intent: "pi_invoice" })),
    stripeDelete: vi.fn<StripeCall>(async () => ({})),
    verifyIdToken: vi.fn(async () => ({ uid: "user-1" })),
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => mocks.db,
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
}));
vi.mock("@/services/billing/stripe.server", () => ({
  getStripeConfig: () => mocks.config,
  stripePost: mocks.stripePost,
  stripeGet: mocks.stripeGet,
  stripeDelete: mocks.stripeDelete,
}));

const { verifyStripeSignature } = await import("@/services/billing/stripe-webhook.server");
const { POST: webhook } = await import("@/app/api/billing/webhook/route");
const { POST: portal } = await import("@/app/api/billing/portal/route");

const PLAN_PATH = "users/user-1/billing/plan";
const priceIds = { plus: "price_plus", pro: "price_pro" };

function signed(event: Record<string, unknown>, secret = "whsec_test", at = Math.floor(Date.now() / 1000)) {
  const payload = JSON.stringify(event);
  const signature = createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex");
  return new NextRequest(new URL("http://localhost/api/billing/webhook"), {
    method: "POST",
    headers: { "stripe-signature": `t=${at},v1=${signature}` },
    body: payload,
  });
}

function checkoutEvent(overrides: Record<string, unknown> = {}, created = 1_790_000_000) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    created,
    data: {
      object: {
        mode: "subscription",
        client_reference_id: "user-1",
        metadata: { uid: "user-1", plan: "plus" },
        customer: "cus_1",
        subscription: "sub_1",
        customer_details: { address: { country: "GB" } },
        ...overrides,
      },
    },
  };
}

function subscriptionEvent(type: string, overrides: Record<string, unknown> = {}, created = 1_790_000_100) {
  return {
    id: "evt_2",
    type,
    created,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        metadata: { uid: "user-1", plan: "plus" },
        items: { data: [{ price: { id: "price_plus" } }] },
        current_period_end: 1_792_600_000,
        cancel_at_period_end: false,
        ...overrides,
      },
    },
  };
}

describe("what a Stripe event means for a plan", () => {
  it("grants a monthly plan from a completed checkout", () => {
    expect(interpretStripeEvent(checkoutEvent(), { priceIds })).toEqual({
      type: "grant",
      uid: "user-1",
      newPurchase: true,
      fields: {
        plan: "plus",
        source: "subscription",
        status: "active",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
      },
    });
  });

  it("grants an Exam Pass only once paid, until its end date", () => {
    const pass = checkoutEvent({
      mode: "payment",
      payment_status: "paid",
      subscription: null,
      metadata: { uid: "user-1", plan: "pro", passExpiresAt: "1816991999999" },
    });
    expect(interpretStripeEvent(pass, { priceIds })).toMatchObject({
      type: "grant",
      fields: { plan: "pro", source: "pass", passExpiresAt: 1816991999999 },
    });
    const unpaid = checkoutEvent({ mode: "payment", payment_status: "unpaid", metadata: { uid: "user-1", plan: "pro", passExpiresAt: "1" } });
    expect(interpretStripeEvent(unpaid, { priceIds }).type).toBe("ignore");
  });

  it("refuses a checkout paid from outside the UK", () => {
    expect(
      interpretStripeEvent(checkoutEvent({ customer_details: { address: { country: "US" } }, invoice: "in_1" }), { priceIds })
    ).toMatchObject({ type: "refuse-country", country: "US", subscriptionId: "sub_1", invoiceId: "in_1" });
  });

  it("follows a plan switched in the portal by its price, and dates a cancellation to when it ended", () => {
    expect(
      interpretStripeEvent(
        subscriptionEvent("customer.subscription.updated", { items: { data: [{ price: { id: "price_pro" } }] } }),
        { priceIds }
      )
    ).toMatchObject({ type: "grant", newPurchase: false, fields: { plan: "pro", currentPeriodEnd: 1_792_600_000_000 } });
    expect(
      interpretStripeEvent(
        subscriptionEvent("customer.subscription.deleted", { status: "canceled", ended_at: 1_790_000_500 }),
        { priceIds }
      )
    ).toMatchObject({ fields: { status: "canceled", currentPeriodEnd: 1_790_000_500_000 } });
  });

  it("ignores events about anyone or anything else", () => {
    expect(interpretStripeEvent({ type: "invoice.paid", data: { object: {} } }, { priceIds }).type).toBe("ignore");
    expect(interpretStripeEvent(checkoutEvent({ client_reference_id: null, metadata: {} }), { priceIds }).type).toBe("ignore");
    expect(planFromPriceId(priceIds, "price_other")).toBeNull();
  });
});

describe("the webhook", () => {
  beforeEach(() => {
    mocks.store.clear();
    vi.clearAllMocks();
    mocks.config = { secretKey: "sk", webhookSecret: "whsec_test", priceIds };
  });

  it("only accepts events Stripe signed in the last five minutes", () => {
    const payload = "{}";
    const at = 1_790_000_000;
    const header = `t=${at},v1=${createHmac("sha256", "s").update(`${at}.${payload}`).digest("hex")}`;
    expect(verifyStripeSignature({ payload, header, secret: "s", now: at * 1000 })).toBe(true);
    expect(verifyStripeSignature({ payload, header, secret: "other", now: at * 1000 })).toBe(false);
    expect(verifyStripeSignature({ payload: "{ }", header, secret: "s", now: at * 1000 })).toBe(false);
    expect(verifyStripeSignature({ payload, header, secret: "s", now: (at + 301) * 1000 })).toBe(false);
    expect(verifyStripeSignature({ payload, header: null, secret: "s" })).toBe(false);
  });

  it("turns a paid checkout into the student's plan, starting a fresh allowance month", async () => {
    mocks.store.set(PLAN_PATH, { periodAnchor: 1 });
    const response = await webhook(signed(checkoutEvent()));
    expect(response.status).toBe(200);
    expect(mocks.store.get(PLAN_PATH)).toMatchObject({
      plan: "plus",
      source: "subscription",
      status: "active",
      stripeCustomerId: "cus_1",
      periodAnchor: 1_790_000_000_000,
      lastEventAt: 1_790_000_000_000,
    });
  });

  it("keeps the allowance month on renewal, and never lets a late event undo a newer one", async () => {
    await webhook(signed(checkoutEvent()));
    await webhook(signed(subscriptionEvent("customer.subscription.deleted", { ended_at: 1_790_000_300 }, 1_790_000_300)));
    await webhook(signed(subscriptionEvent("customer.subscription.updated", {}, 1_790_000_200)));
    expect(mocks.store.get(PLAN_PATH)).toMatchObject({
      status: "canceled",
      currentPeriodEnd: 1_790_000_300_000,
      periodAnchor: 1_790_000_000_000,
    });
  });

  it("rejects an unsigned or forged event without touching the plan", async () => {
    const forged = signed(checkoutEvent(), "not-the-secret");
    expect((await webhook(forged)).status).toBe(400);
    expect(mocks.store.has(PLAN_PATH)).toBe(false);
  });

  it("refunds and ends a purchase from outside the UK, granting nothing", async () => {
    const response = await webhook(signed(checkoutEvent({ customer_details: { address: { country: "FR" } }, invoice: "in_1" })));
    expect(response.status).toBe(200);
    expect(mocks.stripeDelete).toHaveBeenCalledWith(mocks.config, "subscriptions/sub_1");
    expect(mocks.stripePost).toHaveBeenCalledWith(mocks.config, "refunds", expect.objectContaining({ payment_intent: "pi_invoice" }));
    expect(mocks.store.has(PLAN_PATH)).toBe(false);
  });

  it("tries a refund once, however often Stripe redelivers the event", async () => {
    const event = checkoutEvent({ customer_details: { address: { country: "FR" } }, payment_intent: "pi_1", subscription: null });
    await webhook(signed(event));
    await webhook(signed(event));
    expect(mocks.stripePost).toHaveBeenCalledTimes(1);
  });

  it("ends a pass refunded in full, and leaves a subscription's refunds alone", async () => {
    mocks.store.set(PLAN_PATH, { plan: "pro", source: "pass", passExpiresAt: 1_816_991_999_999 });
    const refunded = { id: "evt_r", type: "charge.refunded", created: 1_790_000_900, data: { object: { refunded: true, metadata: { uid: "user-1" } } } };
    await webhook(signed(refunded));
    expect(mocks.store.get(PLAN_PATH)).toMatchObject({ status: "refunded", passExpiresAt: 1_790_000_900_000 });

    mocks.store.set(PLAN_PATH, { plan: "plus", source: "subscription", status: "active" });
    const invoiceRefund = { ...refunded, data: { object: { refunded: true, invoice: "in_1", metadata: { uid: "user-1" } } } };
    await webhook(signed(invoiceRefund));
    expect(mocks.store.get(PLAN_PATH)).toMatchObject({ status: "active" });
  });

  it("never overwrites Lifetime, and keeps a live pass over an old subscription's events", async () => {
    mocks.store.set(PLAN_PATH, { plan: "lifetime" });
    await webhook(signed(checkoutEvent()));
    expect(mocks.store.get(PLAN_PATH)).toEqual({ plan: "lifetime" });

    mocks.store.set(PLAN_PATH, { plan: "pro", source: "pass", passExpiresAt: 1_816_991_999_999, stripeSubscriptionId: null });
    await webhook(signed(subscriptionEvent("customer.subscription.deleted", { id: "sub_old" })));
    expect(mocks.store.get(PLAN_PATH)).toMatchObject({ plan: "pro", source: "pass" });
  });

  it("takes nothing until payments are set up", async () => {
    mocks.config = null;
    expect((await webhook(signed(checkoutEvent()))).status).toBe(503);
  });
});

describe("managing a monthly plan", () => {
  function portalRequest() {
    return new NextRequest(new URL("http://localhost/api/billing/portal"), {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    });
  }

  beforeEach(() => {
    mocks.store.clear();
    vi.clearAllMocks();
    mocks.config = { secretKey: "sk", webhookSecret: "whsec_test", priceIds };
  });

  it("opens Stripe's portal for the student's own customer", async () => {
    mocks.store.set(PLAN_PATH, { stripeCustomerId: "cus_1" });
    const response = await portal(portalRequest());
    expect(await response.json()).toEqual({ url: "https://billing.stripe.com/p/session" });
    expect(mocks.stripePost).toHaveBeenCalledWith(
      mocks.config,
      "billing_portal/sessions",
      expect.objectContaining({ customer: "cus_1" })
    );
  });

  it("says so when there is no monthly plan to manage", async () => {
    const response = await portal(portalRequest());
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("no_subscription");
  });
});
