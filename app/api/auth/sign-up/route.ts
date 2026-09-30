import type { NextRequest } from "next/server";
import {
  isCompleteEmailCode,
  isPlausibleEmail,
  normaliseEmail,
} from "@/lib/auth/email-code";
import { getPasswordRequirementMessage } from "@/lib/auth/password-strength";
import { createLogger } from "@/lib/observability/logger";
import {
  accountExistsResponse,
  authJson,
  codeRefusedResponse,
  crossOriginResponse,
  findAccountByEmail,
  invalidRequestResponse,
  isSameOriginRequest,
  readJsonBody,
} from "@/services/auth/email-code-routes.server";
import { redeemEmailCode } from "@/services/auth/email-code.server";
import { rememberEmailConfirmed } from "@/services/auth/email-confirmation.server";
import { getAdminAuth } from "@/services/firebase/admin";

export const runtime = "nodejs";

const log = createLogger({ route: "auth.sign-up" });

/**
 * Creates an email-and-password account, once its code has been entered.
 *
 * The account is made here by the Admin SDK rather than in the browser, which
 * is what makes this the only way through: it exists only after the code
 * checks out, arrives already confirmed, and has had its password held to
 * Jami's policy by the server rather than by a form that could be skipped.
 *
 * Everything that can be refused without spending the code is refused first,
 * so a weak password or a taken address does not cost the student their code.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return crossOriginResponse();

  const body = await readJsonBody(request);
  if (
    !body ||
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    typeof body.code !== "string"
  ) {
    return invalidRequestResponse();
  }

  const email = normaliseEmail(body.email);
  const { password, code } = body;

  if (!isPlausibleEmail(email)) {
    return authJson(
      { error: "That email address doesn't look right.", code: "auth/invalid-email" },
      400
    );
  }
  if (!isCompleteEmailCode(code)) {
    return authJson(
      { error: "Enter the six-digit code from the email.", code: "email-code/incomplete" },
      400
    );
  }
  const passwordProblem = getPasswordRequirementMessage(password, email);
  if (passwordProblem) {
    return authJson({ error: passwordProblem, code: "jami/weak-password" }, 400);
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

  let redemption;
  try {
    redemption = await redeemEmailCode({ email, code });
  } catch (error) {
    log.error("code_redeem_failed", { error });
    return authJson(
      { error: "That code couldn't be checked just now. Try again in a moment.", code: "email-code/unavailable" },
      503
    );
  }
  if (!redemption.redeemed) return codeRefusedResponse(redemption);

  try {
    const account = await getAdminAuth().createUser({
      email,
      password,
      emailVerified: true,
    });
    rememberEmailConfirmed(account.uid);
  } catch (error) {
    // Two tabs racing the same sign-up: the other one won, and that is fine.
    if ((error as { code?: string })?.code === "auth/email-already-exists") {
      return accountExistsResponse();
    }
    log.error("create_failed", { error });
    return authJson(
      { error: "Your account couldn't be created just now. Send a new code and try again.", code: "auth/create-failed" },
      500
    );
  }

  return authJson({ ok: true }, 201);
}
