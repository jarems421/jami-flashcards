import { describe, expect, it } from "vitest";
import { getCronAuthorizationStatus } from "@/services/auth/cron-authorization";

describe("cron authorization", () => {
  it("fails closed when the configured secret is missing or blank", () => {
    expect(
      getCronAuthorizationStatus({
        authorizationHeader: null,
        configuredSecret: undefined,
      })
    ).toBe("misconfigured");
    expect(
      getCronAuthorizationStatus({
        authorizationHeader: "Bearer anything",
        configuredSecret: "   ",
      })
    ).toBe("misconfigured");
  });

  it("accepts only an exact bearer secret", () => {
    expect(
      getCronAuthorizationStatus({
        authorizationHeader: "Bearer exact-secret",
        configuredSecret: " exact-secret ",
      })
    ).toBe("authorized");
    expect(
      getCronAuthorizationStatus({
        authorizationHeader: "Bearer wrong-secret",
        configuredSecret: "exact-secret",
      })
    ).toBe("unauthorized");
  });

  it("rejects missing, malformed, and differently sized credentials without throwing", () => {
    for (const authorizationHeader of [
      null,
      "",
      "Basic exact-secret",
      "Bearer",
      "Bearer x",
      "Bearer a-much-longer-secret",
    ]) {
      expect(
        getCronAuthorizationStatus({
          authorizationHeader,
          configuredSecret: "exact-secret",
        })
      ).toBe("unauthorized");
    }
  });
});
