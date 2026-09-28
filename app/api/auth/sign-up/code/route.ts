import type { NextRequest } from "next/server";
import { isPlausibleEmail, normaliseEmail } from "@/lib/auth/email-code";
import { createLogger } from "@/lib/observability/logger";
import {
  accountExistsResponse,
  authJson,
  crossOriginResponse,
  deliverEmailCode,
  findAccountByEmail,
  invalidRequestResponse,
  isSameOriginRequest,
  readJsonBody,
} from "@/services/auth/email-code-routes.server";

export const runtime = "nodejs";

const log = createLogger({ route: "auth.sign-up.code" });

/**
 * Emails a code to somebody creating an account.
 *
 * The first half of signing up with an email address: nothing is created
 * here, only a code sent to prove the inbox is real and theirs.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return crossOriginResponse();

  const body = await readJsonBody(request);
  if (!body || typeof body.email !== "string") return invalidRequestResponse();

  const email = normaliseEmail(body.email);
  if (!isPlausibleEmail(email)) {
    return authJson(
      { error: "That email address doesn't look right.", code: "auth/invalid-email" },
      400
    );
  }

  try {
    if (await findAccountByEmail(email)) return accountExistsResponse();
  } catch (error) {
    log.error("account_lookup_failed", { error });
    return authJson(
      { error: "Sign-up isn't available right now. Try again in a moment.", code: "auth/unavailable" },
      503
    );
  }

  return deliverEmailCode(request, email);
}
