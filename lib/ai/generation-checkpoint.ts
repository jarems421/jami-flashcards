import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Remembering the model calls a generation has already paid for.
 *
 * A paper is built from roughly 28 sequential model calls and, until now, none
 * of them were kept. One run "failed at group 16 because the provider dropped
 * the connection, after completing 15 groups", and all fifteen valid groups
 * went with it. That is not an unlucky run: a marking session logged 46 failed
 * calls in an afternoon between rate limits, gateway errors and dropped
 * connections, and a 28-call chain that restarts from nothing on any one of
 * them has a poor chance of ever finishing, however correct the code is.
 *
 * Marking already solved this. `checkpointedMarkerCall` keeps each of its four
 * stages, so the pipeline that needed it least had it and the one that needed
 * it most did not.
 *
 * Verified the only way it can be: a pilot killed part-way banked the design
 * pass and one scheme batch, and the rerun served both from disk and spent its
 * budget on new work instead -- four model calls for $0.003 against the cold
 * run's two for $0.006, reaching the whole-paper audit in the same window. No
 * unit test can show that.
 *
 * Off unless `JAMI_GENERATION_CHECKPOINT_DIR` names a directory, so production
 * and ordinary local runs behave exactly as before. Reading or writing a
 * checkpoint never throws: a cache that cannot be reached must cost a repeated
 * call, never the paper.
 */

/** What identifies a pass, so a rerun can recognise work it already has. */
export type CheckpointKey = {
  /** The pass, e.g. `paper_design` or `mark_scheme_batch`. */
  pass: string;
  /**
   * What this call was *about* -- for a scheme batch, the question ids it
   * covers.
   *
   * Deliberately not the batch's position. High-tariff questions are split into
   * batches of their own, so the same index means different questions between
   * runs, and keying on it would hand back a scheme for the wrong questions
   * while looking like it worked.
   */
  subject: readonly string[];
  /**
   * What the subject actually *says*, when its ids alone cannot identify it.
   *
   * Ids were chosen over positions to stop a batch being served another
   * batch's scheme, and they do not achieve it: every design numbers its
   * questions q1..q18, so an id identifies a slot and not a question. Two
   * designs of the same component wrote into one store and it served the
   * earlier paper's schemes for the later paper's questions -- q5 asked what
   * interference is and was given a scheme for STM encoding and capacity,
   * "acoustic, 7 +/- 2 items". Nothing downstream could see it, and the paper
   * was published.
   *
   * Callers pass a digest of the questions themselves. A design that differs by
   * one word of one prompt misses every scheme batch, which costs a rerun; the
   * alternative cost a student being marked against a question nobody asked
   * them.
   */
  fingerprint?: string;
};

export type CheckpointedPass = { text: string; modelName: string };

const fileFor = (directory: string, key: CheckpointKey) => {
  const subject = [...key.subject].sort().join("|");
  const digest = createHash("sha256")
    .update(`${key.pass}::${subject}::${key.fingerprint ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return join(directory, `${key.pass}-${digest}.json`);
};

/**
 * A stable digest of the questions a pass is about.
 *
 * Prompt and marks, in order: the two things that decide whether a scheme
 * written earlier is still a scheme for this question.
 */
export function questionFingerprint(
  questions: readonly { prompt: string; marks: number }[]
) {
  return createHash("sha256")
    .update(questions.map((question) => `${question.marks}:${question.prompt}`).join("|#|"))
    .digest("hex")
    .slice(0, 16);
}

let warned = false;

function complain(error: unknown) {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn("generation checkpoint unavailable; continuing", String(error).slice(0, 200));
}

/** A pass already completed under this key, or null to run it again. */
export function readGenerationCheckpoint(key: CheckpointKey): CheckpointedPass | null {
  const directory = process.env.JAMI_GENERATION_CHECKPOINT_DIR;
  if (!directory) return null;
  try {
    const path = fileFor(directory, key);
    if (!existsSync(path)) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as CheckpointedPass).text !== "string"
    ) {
      // A half-written file is not a result. Losing one call is the cheap
      // outcome; handing back a truncated scheme as though it were complete is
      // the expensive one.
      return null;
    }
    return parsed as CheckpointedPass;
  } catch (error) {
    complain(error);
    return null;
  }
}

export function writeGenerationCheckpoint(key: CheckpointKey, value: CheckpointedPass) {
  const directory = process.env.JAMI_GENERATION_CHECKPOINT_DIR;
  if (!directory) return;
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(fileFor(directory, key), JSON.stringify({ ...value, key }), "utf8");
  } catch (error) {
    complain(error);
  }
}

/**
 * Forget a pass whose result turned out to be unusable.
 *
 * A checkpoint is written as soon as a call returns, before the caller has
 * judged it, which is what makes a resumed run cheap. It also means a rejected
 * result is remembered: a paper design worth 97 marks against a required 96
 * was cached under the sources it was built from, so every rerun replayed the
 * same wrong paper instead of drawing a new one. The design pass varies enough
 * between attempts to be worth resampling -- 80, 96, 97, 143, 154, 164 and 177
 * marks across seven runs of the same request -- and caching the failure is
 * what stopped that working.
 */
export function forgetGenerationCheckpoint(key: CheckpointKey) {
  const directory = process.env.JAMI_GENERATION_CHECKPOINT_DIR;
  if (!directory) return;
  try {
    rmSync(fileFor(directory, key), { force: true });
  } catch (error) {
    complain(error);
  }
}
