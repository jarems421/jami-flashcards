import type { MarkingCorpusRecord, MarkingCorpusSource } from "@/lib/evaluation/marking-corpus";
import { corpusSource, isShippableAsExemplar } from "./marking-corpus.ts";

/**
 * Keeping the benchmark away from the exemplars.
 *
 * The corpus does two jobs that pull in opposite directions. Measurement asks
 * whether Jami's mark matches a human's. Exemplar retrieval puts marked work
 * *inside* the prompt so the model can see what marked work looks like. If a
 * response can do both, the measurement is worthless: Jami would be shown the
 * answer it is about to be marked on and score beautifully for it. That is not
 * a subtle risk — it is the single easiest way for this system to report
 * excellent accuracy while being no good at all.
 *
 * Three rules, each fail-closed.
 *
 * Whole questions move together, never individual responses. Retrieving a
 * marked answer to the very question under test hands over the mark scheme in
 * all but name, so a question sits on one side of the line or the other.
 *
 * Anything marked by more than one human is benchmark, always. Those records
 * are the only measurement in the corpus of how far two competent markers are
 * from each other, which is the bar Jami is held to. Spending them as exemplars
 * would trade the yardstick for a teaching aid.
 *
 * Licence is checked independently and last. A source nobody has cleared for
 * redistribution cannot be an exemplar whatever the split says.
 */

export type CorpusSide = "benchmark" | "exemplar";

export type HoldoutOptions = {
  /** Share of eligible questions held out for measurement. */
  benchmarkFraction?: number;
  /** Changing this reshuffles the split; keep it fixed once results exist. */
  seed?: string;
  /** Look up a source's licence. Injectable so tests need no catalogue. */
  sourceFor?: (sourceId: string) => MarkingCorpusSource | undefined;
};

const DEFAULTS = {
  benchmarkFraction: 0.3,
  seed: "jami-holdout-v1",
};

/** A question, which is the unit that moves between sides. */
export function groupKey(record: MarkingCorpusRecord) {
  return `${record.sourceId}/${record.questionId}`;
}

/**
 * Stable hash to a fraction in [0, 1).
 *
 * Deterministic across runs and machines: the split has to be the same next
 * week, or yesterday's accuracy figure means nothing.
 */
function hashFraction(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export type HoldoutSplit = {
  benchmark: MarkingCorpusRecord[];
  /** Eligible for retrieval: exemplar side *and* a cleared licence. */
  exemplars: MarkingCorpusRecord[];
  /**
   * Exemplar-side records their source's licence does not permit shipping.
   * Kept separate rather than dropped, so the cost of an unverified licence is
   * visible instead of silently shrinking the pool.
   */
  withheldForLicence: MarkingCorpusRecord[];
  groups: { key: string; side: CorpusSide; records: number; reason: string }[];
};

export function splitCorpus(
  records: readonly MarkingCorpusRecord[],
  options: HoldoutOptions = {}
): HoldoutSplit {
  const fraction = options.benchmarkFraction ?? DEFAULTS.benchmarkFraction;
  const seed = options.seed ?? DEFAULTS.seed;
  const lookup = options.sourceFor ?? corpusSource;

  const grouped = new Map<string, MarkingCorpusRecord[]>();
  for (const record of records) {
    const key = groupKey(record);
    const existing = grouped.get(key);
    if (existing) existing.push(record);
    else grouped.set(key, [record]);
  }

  const benchmark: MarkingCorpusRecord[] = [];
  const exemplars: MarkingCorpusRecord[] = [];
  const withheldForLicence: MarkingCorpusRecord[] = [];
  const groups: HoldoutSplit["groups"] = [];

  for (const key of [...grouped.keys()].sort()) {
    const group = grouped.get(key) ?? [];
    const doubleMarked = group.some((record) => record.humanMarks.length > 1);
    const drawn = hashFraction(`${seed}:${key}`) < fraction;

    const side: CorpusSide = doubleMarked || drawn ? "benchmark" : "exemplar";
    const reason = doubleMarked
      ? "marked by more than one human, so it is calibration data"
      : drawn
        ? "drawn for the held-out benchmark"
        : "available for retrieval";
    groups.push({ key, side, records: group.length, reason });

    if (side === "benchmark") {
      benchmark.push(...group);
      continue;
    }

    const source = lookup(group[0].sourceId);
    if (source && isShippableAsExemplar(source)) exemplars.push(...group);
    else withheldForLicence.push(...group);
  }

  return { benchmark, exemplars, withheldForLicence, groups };
}

export type LeakFinding = { kind: string; detail: string };

/**
 * Check a split for the ways a benchmark answer could reach a prompt.
 *
 * Written as an audit rather than trusted as a consequence of `splitCorpus`,
 * because the split is one function and the guarantee has to hold over
 * whatever a caller assembles — including a pool built by hand, or two splits
 * made with different seeds and then combined.
 */
export function auditHoldout(input: {
  benchmark: readonly MarkingCorpusRecord[];
  exemplars: readonly MarkingCorpusRecord[];
  sourceFor?: (sourceId: string) => MarkingCorpusSource | undefined;
}): LeakFinding[] {
  const lookup = input.sourceFor ?? corpusSource;
  const findings: LeakFinding[] = [];

  const benchmarkIds = new Set(input.benchmark.map((record) => record.id));
  for (const record of input.exemplars) {
    if (benchmarkIds.has(record.id)) {
      findings.push({
        kind: "record in both",
        detail: `${record.id} is a benchmark record and is also retrievable as an exemplar.`,
      });
    }
  }

  const benchmarkQuestions = new Set(input.benchmark.map(groupKey));
  const straddling = new Set(
    input.exemplars.filter((record) => benchmarkQuestions.has(groupKey(record))).map(groupKey)
  );
  for (const key of straddling) {
    findings.push({
      kind: "question in both",
      detail: `${key} has answers on both sides, so marking it would retrieve another answer to the same question.`,
    });
  }

  for (const record of input.exemplars) {
    if (record.humanMarks.length > 1) {
      findings.push({
        kind: "calibration record as exemplar",
        detail: `${record.id} carries ${record.humanMarks.length} human marks and belongs in the benchmark.`,
      });
    }
  }

  const uncleared = new Set(
    input.exemplars
      .map((record) => record.sourceId)
      .filter((sourceId) => {
        const source = lookup(sourceId);
        return !source || !isShippableAsExemplar(source);
      })
  );
  for (const sourceId of uncleared) {
    findings.push({
      kind: "licence not cleared",
      detail: `${sourceId} is in the exemplar pool but its licence has not been verified as redistributable.`,
    });
  }

  return findings;
}

/**
 * The guard a retrieval path must pass before a record enters a prompt.
 * Returns the reason to refuse, or null when the record may be shown.
 */
export function exemplarRefusal(
  record: MarkingCorpusRecord,
  benchmark: readonly MarkingCorpusRecord[],
  sourceFor: (sourceId: string) => MarkingCorpusSource | undefined = corpusSource
): string | null {
  if (record.humanMarks.length > 1) {
    return "Marked by more than one human; this is calibration data and is never an exemplar.";
  }
  const questions = new Set(benchmark.map(groupKey));
  if (questions.has(groupKey(record))) {
    return `Its question (${groupKey(record)}) is in the held-out benchmark.`;
  }
  const source = sourceFor(record.sourceId);
  if (!source || !isShippableAsExemplar(source)) {
    return `The licence for ${record.sourceId} has not been verified as redistributable.`;
  }
  return null;
}
