import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a captured generation response goes when the caller names no sink.
 *
 * `runPass` already offers every model response to its caller, for good
 * reasons written down beside it: five structural faults were each found by
 * burning a live run against a throttling provider, and each was a parser or
 * validator defect reproducible from the response alone.
 *
 * Nothing passes that hook. It is declared, it is called, and no call site
 * supplies it, so as shipped the responses are still discarded and the sixth
 * defect still costs a pilot run. This is the sink that makes the mechanism do
 * what its comment says.
 *
 * Off unless `JAMI_CAPTURE_GENERATION_DIR` names a directory, so production and
 * ordinary local runs write nothing. Capture never throws: a failed write must
 * not take down the generation it is only observing.
 */

export type CapturedPass = {
  /** The pass that produced it, e.g. `paper_design` or `mark_scheme_batch`. */
  pass: string;
  role: string;
  /** Which model answered, since a defect is often one provider's dialect. */
  modelName: string;
  /** Exactly what came back, before any parsing, repair or normalisation. */
  text: string;
};

let warned = false;

export function captureGenerationPass(entry: CapturedPass) {
  const directory = process.env.JAMI_CAPTURE_GENERATION_DIR;
  if (!directory) return;
  try {
    mkdirSync(directory, { recursive: true });
    appendFileSync(
      join(directory, "generation-passes.jsonl"),
      `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`
    );
  } catch (error) {
    // Once, so a broken capture path cannot fill a log with the same line.
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn("generation capture failed; continuing", String(error).slice(0, 200));
    }
  }
}
