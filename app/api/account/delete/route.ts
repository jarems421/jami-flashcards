import type { NextRequest } from "next/server";
import { hasRecentAuthentication } from "@/lib/auth/account-deletion";
import { ACCOUNT_DELETION_CONFIRMATION } from "@/lib/auth/account-deletion-contract";
import { getBearerToken } from "@/lib/auth/bearer";
import { deleteAccountWithAdmin } from "@/services/auth/account-deletion-admin";
import { getAdminAuth } from "@/services/firebase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return json({ error: "Forbidden", code: "account/origin-mismatch" }, 403);
  }

  let body: { confirmation?: unknown };
  try {
    body = (await request.json()) as { confirmation?: unknown };
  } catch {
    return json(
      { error: "Invalid request body", code: "account/invalid-request" },
      400
    );
  }

  if (body.confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
    return json(
      {
        error: "Account deletion was not confirmed.",
        code: "account/confirmation-required",
      },
      400
    );
  }

  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return json({ error: "Unauthorized", code: "auth/unauthorized" }, 401);
  }

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token, true);
    uid = decoded.uid;
    if (!hasRecentAuthentication(decoded.auth_time)) {
      return json(
        {
          error: "Sign in again before deleting your account.",
          code: "auth/requires-recent-login",
        },
        409
      );
    }
  } catch {
    return json({ error: "Unauthorized", code: "auth/unauthorized" }, 401);
  }

  try {
    const deleted = await deleteAccountWithAdmin(uid);
    return json({ ok: true, deleted });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "unknown";
    console.error("Account deletion stopped before completion.", { code });
    return json(
      {
        error:
          "Jami could not finish removing all account data. Your sign-in was kept so you can retry safely.",
        code: "account/deletion-incomplete",
      },
      500
    );
  }
}
