import { describe, expect, it } from "vitest";
import {
  getAuthActionCopy,
  getAuthActionErrorMessage,
  parseAuthActionRequest,
} from "@/lib/auth/auth-action";

function params(query: string) {
  return new URLSearchParams(query);
}

describe("auth action links", () => {
  it("reads the modes Firebase actually sends", () => {
    expect(parseAuthActionRequest(params("mode=resetPassword&oobCode=abc"))).toEqual({
      mode: "resetPassword",
      code: "abc",
    });
    expect(parseAuthActionRequest(params("mode=verifyEmail&oobCode=xyz")).mode).toBe(
      "verifyEmail"
    );
    expect(parseAuthActionRequest(params("mode=recoverEmail&oobCode=xyz")).mode).toBe(
      "recoverEmail"
    );
  });

  it("refuses a mode it does not handle rather than guessing", () => {
    expect(parseAuthActionRequest(params("mode=somethingElse&oobCode=abc")).mode).toBe(
      "unknown"
    );
    expect(parseAuthActionRequest(params("oobCode=abc")).mode).toBe("unknown");
  });

  it("treats a link with no code as unusable, whatever the mode says", () => {
    // The code is the only thing proving the link came from the email.
    expect(parseAuthActionRequest(params("mode=resetPassword")).code).toBeNull();
    expect(
      parseAuthActionRequest(params("mode=resetPassword&oobCode=%20%20")).code
    ).toBeNull();
  });

  it("says something specific for every mode", () => {
    for (const mode of ["resetPassword", "verifyEmail", "recoverEmail", "unknown"] as const) {
      const copy = getAuthActionCopy(mode);
      expect(copy.title.length).toBeGreaterThan(3);
      expect(copy.description.length).toBeGreaterThan(20);
    }
  });

  it("treats an expired or reused link as an instruction, not a failure", () => {
    expect(getAuthActionErrorMessage("auth/expired-action-code")).toMatch(
      /ask for a new one/i
    );
    expect(getAuthActionErrorMessage("auth/invalid-action-code")).toMatch(
      /ask for a new one/i
    );
  });

  it("still says something useful for a code it does not know", () => {
    expect(getAuthActionErrorMessage(undefined)).toMatch(/try again/i);
  });
});
