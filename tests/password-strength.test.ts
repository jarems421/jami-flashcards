import { describe, expect, it } from "vitest";
import {
  assessPassword,
  describePasswordProblem,
  getPasswordRequirementMessage,
  PASSWORD_MINIMUM_LENGTH,
} from "@/lib/auth/password-strength";

describe("password policy", () => {
  it("refuses what Firebase's own six-character floor would allow", () => {
    // Every one of these creates an account under the default rules.
    for (const password of ["123456", "abcdef", "qwerty", "letmein"]) {
      expect(assessPassword(password).acceptable).toBe(false);
    }
  });

  it("asks for length rather than for symbols", () => {
    // A passphrase with no digits or punctuation is a good password.
    expect(assessPassword("correct horse battery").acceptable).toBe(true);
    // And a short one with all the trimmings is not.
    expect(assessPassword("Pw1!aB2@").acceptable).toBe(false);
  });

  it("turns away the passwords that get tried first", () => {
    const assessment = assessPassword("password123");
    expect(assessment.acceptable).toBe(false);
    expect(assessment.problems).toContain("well-known");
  });

  it("is not fooled by capitalising a well-known password", () => {
    expect(assessPassword("Password123").acceptable).toBe(false);
  });

  it("refuses one pattern repeated, however long", () => {
    for (const password of ["aaaaaaaaaaaa", "abababababab", "abcdabcdabcd"]) {
      const assessment = assessPassword(password);
      expect(assessment.acceptable).toBe(false);
      expect(assessment.problems).toContain("too-repetitive");
    }
  });

  it("keeps the email out of the password it protects", () => {
    const assessment = assessPassword("jarems421isgreat", "jarems421@gmail.com");
    expect(assessment.acceptable).toBe(false);
    expect(assessment.problems).toContain("contains-email");
    // The same password protecting a different address is fine.
    expect(assessPassword("jarems421isgreat", "someone@example.com").acceptable).toBe(
      true
    );
  });

  it("ignores an email local part too short to mean anything", () => {
    // Two letters would match almost any password by accident.
    expect(assessPassword("a longer passphrase", "ab@example.com").acceptable).toBe(
      true
    );
  });

  it("scores length above variety", () => {
    const longPlain = assessPassword("thistlebank meadow lantern");
    const shortVaried = assessPassword("Ab1!Ab2@cd");

    expect(longPlain.acceptable).toBe(true);
    expect(shortVaried.acceptable).toBe(true);
    expect(longPlain.strength).toBeGreaterThan(shortVaried.strength);
    expect(longPlain.label).toBe("Strong");
  });

  it("reports the floor before anything else", () => {
    const message = getPasswordRequirementMessage("short", "a@b.com");
    expect(message).toContain(String(PASSWORD_MINIMUM_LENGTH));
    expect(getPasswordRequirementMessage("correct horse battery")).toBeNull();
  });

  it("explains every problem it can raise", () => {
    const problems = [
      "too-short",
      "too-long",
      "well-known",
      "too-repetitive",
      "contains-email",
    ] as const;
    for (const problem of problems) {
      expect(describePasswordProblem(problem).length).toBeGreaterThan(10);
    }
  });

  it("treats an empty password as too short and nothing else", () => {
    const assessment = assessPassword("");
    expect(assessment.problems).toEqual(["too-short"]);
    expect(assessment.label).toBe("Too short");
  });
});
