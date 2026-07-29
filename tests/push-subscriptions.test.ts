import { describe, expect, it } from "vitest";
import {
  hasValidSubscription,
  toPushRecord,
} from "@/lib/app/push-subscriptions";

const validSubscription = {
  endpoint: "https://push.example.com/abc",
  keys: { auth: "auth-key", p256dh: "p256dh-key" },
};

describe("hasValidSubscription", () => {
  it("accepts a subscription with an endpoint and both keys", () => {
    expect(hasValidSubscription(validSubscription)).toBe(true);
  });

  it("rejects an empty endpoint", () => {
    expect(hasValidSubscription({ ...validSubscription, endpoint: "" })).toBe(
      false
    );
  });

  it("rejects a missing keys object", () => {
    expect(hasValidSubscription({ endpoint: validSubscription.endpoint })).toBe(
      false
    );
  });

  it("rejects a null keys object", () => {
    expect(
      hasValidSubscription({ ...validSubscription, keys: null })
    ).toBe(false);
  });

  it("rejects a subscription missing one of the keys", () => {
    expect(
      hasValidSubscription({
        ...validSubscription,
        keys: { auth: "auth-key" },
      })
    ).toBe(false);
  });
});

describe("toPushRecord", () => {
  it("returns null for an invalid subscription", () => {
    expect(toPushRecord({ endpoint: "" })).toBeNull();
  });

  it("keeps a numeric expirationTime", () => {
    const record = toPushRecord({ ...validSubscription, expirationTime: 1234 });
    expect(record).toEqual({
      endpoint: validSubscription.endpoint,
      expirationTime: 1234,
      keys: { auth: "auth-key", p256dh: "p256dh-key" },
    });
  });

  it("normalises a missing expirationTime to null", () => {
    expect(toPushRecord(validSubscription)?.expirationTime).toBeNull();
  });

  it("normalises a non-numeric expirationTime to null", () => {
    expect(
      toPushRecord({ ...validSubscription, expirationTime: "soon" })
        ?.expirationTime
    ).toBeNull();
  });
});
