import "server-only";

import { accountMayUseAi } from "@/lib/auth/email-code";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";

/**
 * Whether an account's email lets it use Jami's AI, as the server sees it.
 *
 * Asked before any AI allowance is handed out, so it covers every route that
 * spends. Existing students are never affected: an unconfirmed account made
 * before code sign-up went live keeps its AI and is never asked to confirm.
 * What it stops is a script making throwaway accounts straight through
 * Firebase, around the sign-up form, for a fresh daily allowance each.
 *
 * Allowed accounts are remembered for the life of the server instance, since
 * nothing takes that away. A refused one is asked about again after a while.
 */

const ALLOWED = new Set<string>();
const REFUSED_CHECKED_AT = new Map<string, number>();
const REFUSED_RECHECK_MS = 30_000;
/** Bounds memory on a long-lived instance; forgetting only costs a lookup. */
const REMEMBERED_LIMIT = 5_000;

/**
 * When confirmation started to count: the moment the live app first ran this
 * code, stamped once into Firestore by whichever production instance got
 * there first.
 *
 * A date in the source would have to guess the deploy. Guess early and
 * students who signed up in the old way in between would lose AI with no way
 * to get it back; guess late and the gap stays open. Stamping it from the
 * deployment itself is exact. Only production stamps it -- a laptop or a
 * preview pointed at the same project must not start the clock -- and until it
 * is stamped, nobody is refused.
 */
const SETTINGS_COLLECTION = "serverSettings";
const SETTINGS_DOC = "emailConfirmation";
/** How often an instance that found no stamp looks again. */
const UNSTAMPED_RECHECK_MS = 10 * 60_000;

let requiredFrom: { value: number | null; readAt: number } | null = null;

function readTime(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function getConfirmationRequiredFrom(now: number) {
  if (
    requiredFrom &&
    (requiredFrom.value !== null || now - requiredFrom.readAt < UNSTAMPED_RECHECK_MS)
  ) {
    return requiredFrom.value;
  }

  const db = getAdminDb();
  const ref = db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC);
  const value =
    process.env.VERCEL_ENV === "production"
      ? await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(ref);
          const stamped = readTime(snapshot.data()?.requiredFrom);
          if (stamped !== null) return stamped;
          transaction.set(ref, { requiredFrom: now });
          return now;
        })
      : readTime((await ref.get()).data()?.requiredFrom);

  requiredFrom = { value, readAt: now };
  return value;
}

export function rememberEmailConfirmed(uid: string) {
  REFUSED_CHECKED_AT.delete(uid);
  if (ALLOWED.size >= REMEMBERED_LIMIT) ALLOWED.clear();
  ALLOWED.add(uid);
}

export async function emailAllowsAi(uid: string, now = Date.now()) {
  if (ALLOWED.has(uid)) return true;

  // First, so the first request after a deploy stamps the start time even
  // when the account asking is one that would be allowed anyway.
  const confirmationRequiredFrom = await getConfirmationRequiredFrom(now);

  const refusedAt = REFUSED_CHECKED_AT.get(uid);
  if (refusedAt !== undefined && now - refusedAt < REFUSED_RECHECK_MS) {
    return false;
  }

  const account = await getAdminAuth().getUser(uid);
  const createdAt = Date.parse(account.metadata.creationTime);
  const allowed = accountMayUseAi(
    {
      email: account.email,
      emailVerified: account.emailVerified,
      providerIds: account.providerData.map((provider) => provider.providerId),
      createdAt: Number.isFinite(createdAt) ? createdAt : null,
    },
    confirmationRequiredFrom
  );

  if (!allowed) {
    if (REFUSED_CHECKED_AT.size >= REMEMBERED_LIMIT) REFUSED_CHECKED_AT.clear();
    REFUSED_CHECKED_AT.set(uid, now);
    return false;
  }

  rememberEmailConfirmed(uid);
  return true;
}
