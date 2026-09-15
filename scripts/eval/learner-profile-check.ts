/**
 * A read-only check of the Learning Engine against a real Firebase project.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/learner-profile-check.ts \
 *     --uid <uid> [--folder <folderId> | --deck <deckId>]
 *
 * Answers the production questions unit tests cannot: does the review-history
 * index exist, are events well-formed, does history outlive deleted decks, how
 * long does a profile take to build, and where do study actions send the
 * student. It reads only, and prints counts, codes, timings and ids -- never a
 * topic name, card text or an answer.
 */
import {
  FLASHCARD_REVIEW_EVENTS_COLLECTION,
  decodeFlashcardReviewEvent,
} from "@/lib/learning/events/flashcard-review-event";
import { learnerProfileTelemetry } from "@/lib/learning/telemetry";
import { getAdminDb } from "@/services/firebase/admin";
import { loadLearnerProfile } from "@/services/learning/learner-profile.server";
import { loadStudyActions } from "@/services/learning/study-actions.server";

const EVENT_SAMPLE = 200;

function readArgument(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value.trim() : undefined;
}

function describeFailure(error: unknown) {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    // A missing index names itself, with the console link to create it, in the message.
    return { name: error.name, ...(code !== undefined ? { code } : {}), message: error.message.slice(0, 400) };
  }
  return { name: "NonError" };
}

async function checkReviewHistory(uid: string) {
  const db = getAdminDb();
  const events = db.collection("users").doc(uid).collection(FLASHCARD_REVIEW_EVENTS_COLLECTION);
  const sample = await events.orderBy("reviewedAt", "desc").limit(EVENT_SAMPLE).get();
  const decoded = sample.docs.map((eventDoc) =>
    decodeFlashcardReviewEvent(eventDoc.id, eventDoc.data() as Record<string, unknown>)
  );
  const valid = decoded.filter((event) => event !== null);
  const deckIds = Array.from(new Set(valid.map((event) => event.deckId))).sort();

  let deckIndex: "ok" | "not-checked" | ReturnType<typeof describeFailure> = "not-checked";
  if (deckIds.length > 0) {
    try {
      // The exact shape the profile loader runs, so a missing index fails here first.
      await events.where("deckId", "in", deckIds.slice(0, 30)).orderBy("reviewedAt", "desc").limit(1).get();
      deckIndex = "ok";
    } catch (error) {
      deckIndex = describeFailure(error);
    }
  }

  const deckSnapshots = deckIds.length > 0
    ? await db.getAll(...deckIds.map((deckId) => db.collection("decks").doc(deckId)))
    : [];
  const missingDecks = new Set(
    deckSnapshots.flatMap((snapshot, index) => {
      const data = snapshot.data() as Record<string, unknown> | undefined;
      const owner = data?.userId ?? data?.uid;
      return !snapshot.exists || owner !== uid ? [deckIds[index]] : [];
    })
  );

  return {
    sampled: sample.size,
    malformed: decoded.length - valid.length,
    decks: deckIds.length,
    eventsForMissingOrForeignDecks: valid.filter((event) => missingDecks.has(event.deckId)).length,
    deckReviewedAtIndex: deckIndex,
  };
}

export default async function main(args: string[]) {
  const uid = readArgument(args, "--uid");
  const folderId = readArgument(args, "--folder");
  const deckId = readArgument(args, "--deck");
  if (!uid) {
    throw new Error("Usage: learner-profile-check.ts --uid <uid> [--folder <folderId> | --deck <deckId>]");
  }

  const report: Record<string, unknown> = { uid, checkedAt: new Date().toISOString() };

  try {
    report.reviewHistory = await checkReviewHistory(uid);
  } catch (error) {
    report.reviewHistory = { failed: describeFailure(error) };
  }

  if (folderId || deckId) {
    const startedAt = Date.now();
    try {
      const profile = await loadLearnerProfile({ uid, ...(folderId ? { folderId } : { deckId }) });
      report.profile = profile
        ? { latencyMs: Date.now() - startedAt, ...learnerProfileTelemetry(profile) }
        : { latencyMs: Date.now() - startedAt, found: false };
    } catch (error) {
      report.profile = { latencyMs: Date.now() - startedAt, failed: describeFailure(error) };
    }
  }

  const actionsStartedAt = Date.now();
  try {
    const result = await loadStudyActions({ uid });
    report.studyActions = {
      latencyMs: Date.now() - actionsStartedAt,
      folders: result.evaluatedFolders,
      failedFolders: result.failedFolders,
      actions: result.actions.map((action) => ({
        reason: action.reason,
        action: action.action,
        destination: action.destination?.kind,
        href: action.destination?.href,
      })),
    };
  } catch (error) {
    report.studyActions = { latencyMs: Date.now() - actionsStartedAt, failed: describeFailure(error) };
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
