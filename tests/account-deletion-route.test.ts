import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/lib/auth/account-deletion-contract";

const routeMocks = vi.hoisted(() => ({
  deleteAccountWithAdmin: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: routeMocks.verifyIdToken }),
}));

vi.mock("@/services/auth/account-deletion-admin", () => ({
  deleteAccountWithAdmin: routeMocks.deleteAccountWithAdmin,
}));

function createRequest(options?: {
  confirmation?: string;
  token?: string;
  origin?: string;
}) {
  return new NextRequest("https://jami.test/api/account/delete", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(options?.token
        ? { Authorization: `Bearer ${options.token}` }
        : {}),
      Origin: options?.origin ?? "https://jami.test",
    },
    body: JSON.stringify({
      confirmation:
        options?.confirmation ?? ACCOUNT_DELETION_CONFIRMATION,
    }),
  });
}

describe("DELETE /api/account/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.deleteAccountWithAdmin.mockResolvedValue({
      rootDocuments: 0,
      userCollections: 0,
      userDocuments: 0,
      storageObjects: 0,
    });
  });

  it("rejects requests without an authenticated bearer token", async () => {
    const { DELETE } = await import("@/app/api/account/delete/route");
    const response = await DELETE(createRequest());

    expect(response.status).toBe(401);
    expect(routeMocks.deleteAccountWithAdmin).not.toHaveBeenCalled();
  });

  it("requires a recent authentication before destructive cleanup", async () => {
    routeMocks.verifyIdToken.mockResolvedValue({
      uid: "user-a",
      auth_time: Math.floor(Date.now() / 1_000) - 601,
    });
    const { DELETE } = await import("@/app/api/account/delete/route");
    const response = await DELETE(createRequest({ token: "stale-token" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "auth/requires-recent-login",
    });
    expect(routeMocks.deleteAccountWithAdmin).not.toHaveBeenCalled();
  });

  it("deletes only the uid verified from the recent Firebase token", async () => {
    routeMocks.verifyIdToken.mockResolvedValue({
      uid: "user-a",
      auth_time: Math.floor(Date.now() / 1_000),
    });
    const { DELETE } = await import("@/app/api/account/delete/route");
    const response = await DELETE(createRequest({ token: "fresh-token" }));

    expect(response.status).toBe(200);
    expect(routeMocks.verifyIdToken).toHaveBeenCalledWith("fresh-token", true);
    expect(routeMocks.deleteAccountWithAdmin).toHaveBeenCalledWith("user-a");
  });
});
