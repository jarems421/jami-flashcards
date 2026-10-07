import "server-only";

import {
  TUTOR_CHECKS_COLLECTION,
  buildTutorCheckWrite,
  decodeTutorCheck,
  readTutorCheckMarking,
  type PendingTutorCheck,
  type TutorCheck,
  type TutorCheckRejection,
} from "@/lib/learning/events/tutor-check";
import { featureFlags } from "@/lib/app/feature-flags";
import { createLogger } from "@/lib/observability/logger";
import { getAdminDb } from "@/services/firebase/admin";

const log = createLogger({ route: "learning.tutor_checks" });

/** Bounded like every other profile read. */
export const TUTOR_CHECK_LIMIT = 120;

export type RecordTutorCheckOutcome =
  | { recorded: true }
  | { recorded: false; reason: TutorCheckRejection | "malformed" };

/**
 * Store the marked answer to a pending quick check, if it was one.
 *
 * Written through the Admin SDK because the rules refuse client writes: a
 * student who could write their own checks could write their own evidence.
 * Filed under the check's own id, so a retried request replaces rather than
 * adds.
 */
export async function recordTutorCheck(input: {
  uid: string;
  pending: PendingTutorCheck;
  verdict: unknown;
  markedAt?: number;
}): Promise<RecordTutorCheckOutcome> {
  const uid = input.uid.trim();
  if (!uid) return { recorded: false, reason: "malformed" };
  const result = readTutorCheckMarking({
    verdict: input.verdict,
    pending: input.pending,
    markedAt: input.markedAt ?? Date.now(),
  });
  if (!result.ok) return { recorded: false, reason: result.reason };
  await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection(TUTOR_CHECKS_COLLECTION)
    .doc(input.pending.id)
    .set(buildTutorCheckWrite(result.check, Date.now()));
  return { recorded: true };
}

/**
 * A student's marked quick checks in one scope, for the learner profile.
 *
 * A failure costs quick-check evidence and nothing else, as for every source.
 */
export async function loadTutorChecks(input: {
  uid: string;
  folderId?: string;
  deckId?: string;
}): Promise<TutorCheck[]> {
  const uid = input.uid.trim();
  if (!featureFlags.enableTutorChecks || !uid || (!input.folderId && !input.deckId)) return [];
  try {
    const snapshot = await getAdminDb()
      .collection("users")
      .doc(uid)
      .collection(TUTOR_CHECKS_COLLECTION)
      .orderBy("markedAt", "desc")
      .limit(TUTOR_CHECK_LIMIT)
      .get();
    return snapshot.docs.flatMap((document) => {
      const check = decodeTutorCheck(document.id, document.data() as Record<string, unknown>);
      if (!check) return [];
      const inScope = input.folderId
        ? "folderId" in check.scope && check.scope.folderId === input.folderId
        : "deckId" in check.scope && check.scope.deckId === input.deckId;
      return inScope ? [check] : [];
    });
  } catch (error) {
    log.warn("checks.unavailable", { error });
    return [];
  }
}
