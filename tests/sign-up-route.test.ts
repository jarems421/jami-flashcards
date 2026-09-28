import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/*
 * Creating an account with an emailed code. The route's own checks are real;
 * Firebase Admin and the code store are stubbed.
 */

const mocks = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  redeemEmailCode: vi.fn(),
  rememberEmailConfirmed: vi.fn(),
}));

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({
    getUserByEmail: mocks.getUserByEmail,
    createUser: mocks.createUser,
  }),
}));

vi.mock("@/services/auth/email-code.server", () => ({
  redeemEmailCode: mocks.redeemEmailCode,
  issueEmailCode: vi.fn(),
  withdrawEmailCode: vi.fn(),
}));

vi.mock("@/services/auth/email-confirmation.server", () => ({
  rememberEmailConfirmed: mocks.rememberEmailConfirmed,
}));

let post: (request: NextRequest) => Promise<Response>;

function request(body: Record<string, unknown>, origin = "http://localhost") {
  return new Request("http://localhost/api/auth/sign-up", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const valid = { email: "Sam@Example.com", password: "maple river lantern", code: "123456" };

beforeAll(async () => {
  ({ POST: post } = await import("@/app/api/auth/sign-up/route"));
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserByEmail.mockRejectedValue({ code: "auth/user-not-found" });
  mocks.redeemEmailCode.mockResolvedValue({ redeemed: true });
  mocks.createUser.mockResolvedValue({ uid: "new-user" });
});

describe("sign-up route", () => {
  it("creates the account confirmed once the code checks out", async () => {
    const response = await post(request(valid));
    expect(response.status).toBe(201);
    expect(mocks.redeemEmailCode).toHaveBeenCalledWith({
      email: "sam@example.com",
      code: "123456",
    });
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "sam@example.com",
      password: "maple river lantern",
      emailVerified: true,
    });
    expect(mocks.rememberEmailConfirmed).toHaveBeenCalledWith("new-user");
  });

  it("creates nothing when the code is wrong", async () => {
    mocks.redeemEmailCode.mockResolvedValue({
      redeemed: false,
      failure: "mismatch",
      attemptsLeft: 3,
    });
    const response = await post(request(valid));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe("email-code/mismatch");
    expect(body.error).toContain("3 tries left");
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("refuses a weak password without spending the code", async () => {
    const response = await post(request({ ...valid, password: "iloveyou" }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("jami/weak-password");
    expect(mocks.redeemEmailCode).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("refuses an address that already has an account without spending the code", async () => {
    mocks.getUserByEmail.mockResolvedValue({ uid: "existing" });
    const response = await post(request(valid));
    expect(response.status).toBe(409);
    expect(mocks.redeemEmailCode).not.toHaveBeenCalled();
  });

  it("refuses an incomplete code before looking anything up", async () => {
    const response = await post(request({ ...valid, code: "12345" }));
    expect(response.status).toBe(400);
    expect(mocks.getUserByEmail).not.toHaveBeenCalled();
  });

  it("cannot be driven from another site", async () => {
    const response = await post(request(valid, "https://elsewhere.example"));
    expect(response.status).toBe(403);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("treats losing a race to the same address as the address being taken", async () => {
    mocks.createUser.mockRejectedValue({ code: "auth/email-already-exists" });
    const response = await post(request(valid));
    expect(response.status).toBe(409);
  });
});
