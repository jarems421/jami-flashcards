import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
};

export type CheckpointedPass = { text: string; modelName: string };

const fileFor = (directory: string, key: CheckpointKey) => {
  const subject = [...key.subject].sort().join("|");
  const digest = createHash("sha256").update(`${key.pass}::${subject}`).digest("hex").slice(0, 16);
  return join(directory, `${key.pass}-${digest}.json`);
};

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
