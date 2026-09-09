import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Who is allowed to write on a student's behalf.
 *
 * Firestore rules refuse a demo account every write in the app, but the exam
 * routes go through the Admin SDK, which writes straight past them. That makes
 * this the only gate between a shared demo login and a session that spends the
 * AI budget and stores answers, so it is tested directly rather than inferred
 * from the rules.
 */
const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
}));

const { apiFailure, authenticateRequest, authenticateWriteRequest } = await import(
  "@/services/auth/authenticate-request.server"
);

function requestWith(header: string | null) {
  return {
    headers: { get: (name: string) => (name === "authorization" ? header : null) },
  } as unknown as NextRequest;
}

describe("exam practice request authentication", () => {
  beforeEach(() => {
    mocks.verifyIdToken.mockReset();
  });

  it("reads the uid from a valid bearer token", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "student-1" });
    expect(await authenticateRequest(requestWith("Bearer abc123"))).toBe("student-1");
    expect(await authenticateWriteRequest(requestWith("Bearer abc123"))).toBe("student-1");
  });

  it("refuses a demo account any write while still letting it read", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "demo-1", demo: true });
    expect(await authenticateWriteRequest(requestWith("Bearer demo"))).toBeNull();
    expect(await authenticateRequest(requestWith("Bearer demo"))).toBe("demo-1");
  });

  it("treats a missing, malformed or rejected token as nobody", async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: "student-1" });
    expect(await authenticateWriteRequest(requestWith(null))).toBeNull();
    expect(await authenticateWriteRequest(requestWith("abc123"))).toBeNull();
    expect(await authenticateRequest(requestWith("Basic abc123"))).toBeNull();
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();

    mocks.verifyIdToken.mockRejectedValue(new Error("expired"));
    expect(await authenticateWriteRequest(requestWith("Bearer stale"))).toBeNull();
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
