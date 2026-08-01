import "server-only";

import { timingSafeEqual } from "node:crypto";
import { getBearerToken } from "@/lib/auth/bearer";

export type CronAuthorizationStatus =
  | "authorized"
  | "misconfigured"
  | "unauthorized";

/**
 * Verifies the bearer secret Vercel sends to cron routes.
 *
 * Configuration is checked separately from the request so an unset secret can
 * never turn into a credential the caller can reproduce. The length guard is
 * required because timingSafeEqual throws when its inputs differ in length.
 */
export function getCronAuthorizationStatus(input: {
  authorizationHeader: string | null;
  configuredSecret: string | undefined;
}): CronAuthorizationStatus {
  const expected = input.configuredSecret?.trim() ?? "";
  if (!expected) return "misconfigured";

  const supplied = getBearerToken(input.authorizationHeader);
  if (!supplied) return "unauthorized";

  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  if (expectedBytes.length !== suppliedBytes.length) return "unauthorized";

  return timingSafeEqual(expectedBytes, suppliedBytes)
    ? "authorized"
    : "unauthorized";
}
