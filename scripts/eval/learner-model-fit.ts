/**
 * Fit the learner model's constants to a real student's own history.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/learner-model-fit.ts \
 *     (--uid UID | --email ADDRESS) (--folder FOLDER_ID | --deck DECK_ID) [--train 0.7] [--passes 3]
 *
 * The folder id is the last part of the folder's own URL:
 * /dashboard/folders/FOLDER_ID.
 *
 * Every number in `lib/learning/scoring/tuning.ts` was set by hand and has never
 * been checked against anyone's answers. This replays one student's history
 * under candidate values, keeps whichever predicted their answers best, and
 * reports the result on a later stretch that was kept back from the fitting.
 *
 * Read only. It prints counts and errors and nothing else -- no topic name, no
 * card, no answer, not even which topics were involved.
 *
 * One student is one sample. A change worth making should show up across
 * several students and on their held-back stretch, not just on one run.
 */
import { fitLearningTuning, type TuningFit } from "@/lib/learning/evaluation/fit-tuning";
import {
  replayLearnerModelPredictions,
  summarizeLearnerModelEvaluation,
} from "@/lib/learning/evaluation/learner-model-evaluation";
import { collectLearnerObservations } from "@/lib/learning/profile/build-learner-profile";
import { getAdminAuth } from "@/services/firebase/admin";
import { loadLearnerEvidence } from "@/services/learning/learner-profile.server";

function readArgument(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value.trim() : undefined;
}

function readNumber(args: readonly string[], name: string) {
  const raw = readArgument(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function round(value: number | null, places = 5) {
  return value === null ? null : Number(value.toFixed(places));
}

/** The signed-in account, by uid or by the address it signs in with. */
async function resolveUid(args: readonly string[]) {
  const uid = readArgument(args, "--uid");
  if (uid) return uid;
  const email = readArgument(args, "--email");
  if (!email) return undefined;
  const user = await getAdminAuth().getUserByEmail(email);
  return user.uid;
}

/**
 * What the run is actually entitled to conclude.
 *
 * Ordered by how early the run ran out of evidence, because the interesting
 * failure is not overfitting -- it is having nothing to fit on and saying so.
 */
function describeVerdict(fit: TuningFit, datedObservations: number) {
  const predictions = fit.fittedScore.trainPredictions + fit.fittedScore.holdoutPredictions;
  if (datedObservations === 0) {
    return (
      "No dated evidence in this scope, so nothing can be replayed. Cards read from their running " +
      "totals record how often a card was forgotten but not when, and only recorded review events " +
      "and marked answers carry the history a replay needs."
    );
  }
  if (predictions === 0) {
    return "Dated evidence exists, but no topic has a second answer to predict from yet.";
  }
  if (!fit.sufficient) return "Not enough held back to judge. Do not apply these constants.";
  if (fit.changes.length === 0) return "No constant earned a change. The hand-set values stand.";
  return (fit.fittedScore.holdoutMse ?? 1) <= (fit.baselineScore.holdoutMse ?? 0)
    ? "Fitted constants also beat the hand-set ones on the held-back stretch."
    : "Fitted on the earlier stretch but WORSE on the held-back one: overfitted, do not apply.";
}

export default async function main(args: string[]) {
  const folderId = readArgument(args, "--folder");
  const deckId = readArgument(args, "--deck");
  if ((!readArgument(args, "--uid") && !readArgument(args, "--email")) || (!folderId && !deckId)) {
    throw new Error(
      "Usage: learner-model-fit.ts (--uid UID | --email ADDRESS) (--folder FOLDER_ID | --deck DECK_ID) " +
        "[--train 0.7] [--passes 3]. " +
        "The folder id is the last part of its URL: /dashboard/folders/FOLDER_ID"
    );
  }
  const uid = await resolveUid(args);
  if (!uid) throw new Error("No account matched that --uid or --email.");

  const now = Date.now();
  const loaded = await loadLearnerEvidence({ uid, ...(folderId ? { folderId } : { deckId }) });
  if (!loaded) throw new Error("That folder or deck could not be found.");

  const { observations } = collectLearnerObservations(loaded.evidence, now);
  const dated = observations.filter((observation) => observation.trendEligible);

  const fit = fitLearningTuning(observations, {
    ...(readNumber(args, "--train") !== undefined ? { trainFraction: readNumber(args, "--train") as number } : {}),
    ...(readNumber(args, "--passes") !== undefined ? { passes: readNumber(args, "--passes") as number } : {}),
  });

  const calibration = (tuning: typeof fit.fitted) => {
    const summary = summarizeLearnerModelEvaluation(
      replayLearnerModelPredictions(observations, tuning)
    );
    return {
      predictions: summary.predictions,
      sufficient: summary.sufficient,
      meanSquaredError: round(summary.meanSquaredError),
      byConfidence: summary.byConfidence.map((row) => ({
        confidence: row.confidence,
        predictions: row.predictions,
        meanAbsoluteError: round(row.meanAbsoluteError),
      })),
      calibration: summary.calibration.map((bucket) => ({
        band: `${bucket.lower.toFixed(1)}-${bucket.upper.toFixed(1)}`,
        predictions: bucket.predictions,
        meanPredicted: round(bucket.meanPredicted, 3),
        meanOutcome: round(bucket.meanOutcome, 3),
      })),
    };
  };

  process.stdout.write(
    `${JSON.stringify(
      {
        uid,
        scope: folderId ? { folderId } : { deckId },
        fittedAt: new Date(now).toISOString(),
        evidence: {
          observations: observations.length,
          // Only dated evidence can be replayed; aggregate card state cannot.
          datedObservations: dated.length,
        },
        split: {
          // Infinite when nothing could be replayed: there is no moment at
          // which to split a history that does not exist.
          at: Number.isFinite(fit.splitAt) ? new Date(fit.splitAt).toISOString() : null,
          trainPredictions: fit.fittedScore.trainPredictions,
          holdoutPredictions: fit.fittedScore.holdoutPredictions,
        },
        error: {
          baseline: {
            train: round(fit.baselineScore.trainMse),
            holdout: round(fit.baselineScore.holdoutMse),
          },
          fitted: {
            train: round(fit.fittedScore.trainMse),
            holdout: round(fit.fittedScore.holdoutMse),
          },
        },
        changes: fit.changes,
        recommended: fit.changes.length > 0 ? fit.fitted : null,
        verdict: describeVerdict(fit, dated.length),
        baselineCalibration: calibration(fit.baseline),
        fittedCalibration: calibration(fit.fitted),
      },
      null,
      2
    )}
`
  );
}
