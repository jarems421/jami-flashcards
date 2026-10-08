import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Who a server route is acting for.
 *
 * Every route that reads or writes a student's data with the Admin SDK goes
 * past the Firestore rules, so this one check is the gate, and it is tested
 * directly rather than inferred from the rules.
 */
const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
}));

const { apiFailure, authenticateRequest } = await import(
  "@/services/auth/authenticate-request.server"
);

function requestWith(header: string | null) {
  return {
    headers: { get: (name: string) => (name === "authorization" ? header : null) },
  } as unknown as NextRequest;
}

describe("server route authentication", () => {
  beforeEach(() => {
    mocks.verifyIdToken.mockReset();
  });

  it("reads the uid from a valid bearer token", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "student-1" });
    expect(await authenticateRequest(requestWith("Bearer abc123"))).toBe("student-1");
  });

  it("treats a missing, malformed or rejected token as nobody", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "student-1" });
    expect(await authenticateRequest(requestWith(null))).toBeNull();
    expect(await authenticateRequest(requestWith("abc123"))).toBeNull();
    expect(await authenticateRequest(requestWith("Basic abc123"))).toBeNull();
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();

    mocks.verifyIdToken.mockRejectedValue(new Error("expired"));
    expect(await authenticateRequest(requestWith("Bearer stale"))).toBeNull();
  });

  it("does not leak anything but the message and code in a failure", async () => {
    const response = apiFailure("Question not found.", 404, "question_not_found");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Question not found.",
      code: "question_not_found",
    });
  });
});
