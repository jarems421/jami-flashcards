import { describe, expect, it } from "vitest";
import { getFriendlyAuthError } from "@/lib/auth/errors";

describe("friendly auth errors", () => {
  it("maps common Firebase codes to clear guidance", () => {
    expect(getFriendlyAuthError("auth/invalid-credential")).toBe(
      "The email or password is incorrect."
    );
    expect(getFriendlyAuthError("auth/network-request-failed")).toContain(
      "Check your connection"
    );
  });

  it("never exposes an unknown technical code", () => {
    expect(getFriendlyAuthError("auth/internal-error")).toBe(
      "Sign-in did not work. Please try again."
    );
  });
});
