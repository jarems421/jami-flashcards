/**
 * What the notebook's ink pipeline costs, printed as a table.
 *
 *   node scripts/run-ts.mjs scripts/eval/ink-latency.ts [--rate 240] [--noise 0.5]
 *     [--beta 0.08] [--min-cutoff 9] [--compare] [--uncorrected]
 *
 * Reads nothing and writes nothing. It replays synthetic strokes through the
 * real smoothing filter, so it needs no device, no account and no network.
 *
 * `--compare` prints the tuned pipeline beside whatever `--beta` and
 * `--min-cutoff` say, which is the way to see what a constant actually buys
 * before changing it. The tension to watch is lag against jitter: every change
 * that closes the gap to the pen lets more sensor noise into the line.
 *
 * A device is still the judge. The browser's own latency is most of what a hand
 * feels and none of it is visible here -- see the note at the top of
 * `lib/workspace/notebook-ink-latency.ts`.
 */
import {
  measureInkPipeline,
  type InkLatencyMetrics,
} from "@/lib/workspace/notebook-ink-latency";
import {
  NOTEBOOK_INK_SMOOTHING,
  type NotebookInkSmoothingOptions,
} from "@/lib/workspace/notebook-ink-smoothing";

function readNumber(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  const raw = index >= 0 ? args[index + 1] : undefined;
  if (!raw || raw.startsWith("--")) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function table(rows: InkLatencyMetrics[], title: string) {
  console.log(`\n${title}`);
  console.log(
    `${"stroke".padEnd(14)}${"samples".padStart(8)}${"lag".padStart(9)}` +
      `${"worst".padStart(9)}${"trail".padStart(9)}${"jitter".padStart(9)}`
  );
  for (const row of rows) {
    console.log(
      row.stroke.padEnd(14) +
        String(row.samples).padStart(8) +
        row.meanLagPx.toFixed(3).padStart(9) +
        row.worstLagPx.toFixed(3).padStart(9) +
        row.trailAtLiftPx.toFixed(3).padStart(9) +
        row.survivingJitterPx.toFixed(3).padStart(9)
    );
  }
}

export default function main(args: readonly string[] = process.argv.slice(2)) {
  const sampleRateHz = readNumber(args, "--rate") ?? 240;
  const noisePx = readNumber(args, "--noise") ?? 0.5;
  const strokes = { sampleRateHz, noisePx };

  console.log(
    `Ink pipeline at ${sampleRateHz}Hz with ${noisePx}px of sensor noise. ` +
      `All figures in pixels; lower is better, except that lag and jitter ` +
      `trade against each other.`
  );
  table(measureInkPipeline(strokes), "tuned (what ships today)");

  if (args.includes("--uncorrected")) {
    table(
      measureInkPipeline(strokes, {
        ...NOTEBOOK_INK_SMOOTHING,
        prediction: null,
      }),
      "lag correction off (the filter on its own)"
    );
  }

  if (args.includes("--compare")) {
    const candidate: NotebookInkSmoothingOptions = {
      ...NOTEBOOK_INK_SMOOTHING,
      beta: readNumber(args, "--beta") ?? NOTEBOOK_INK_SMOOTHING.beta,
      minCutoff:
        readNumber(args, "--min-cutoff") ?? NOTEBOOK_INK_SMOOTHING.minCutoff,
    };
    table(
      measureInkPipeline(strokes, candidate),
      `candidate (beta ${candidate.beta}, minCutoff ${candidate.minCutoff})`
    );
  }
}

