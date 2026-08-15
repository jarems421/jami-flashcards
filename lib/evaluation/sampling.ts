import type {
  MarkingCorpusRecord,
  MarkingLevel,
  MarkingRegime,
} from "@/lib/evaluation/marking-corpus";

/**
 * Choosing what to actually mark, and refusing to spend more than intended.
 *
 * A broad corpus and a cheap evaluation are not in tension, because they are
 * different things. Every response ingested improves stratification and gives
 * exemplar retrieval more to choose from, at no cost. Only responses actually
 * marked cost money — so a run takes a stratified sample rather than the lot.
 *
 * Stratified, not random: coverage is the point. A random thousand from a
 * corpus dominated by short-answer computer science would say almost nothing
 * about banded essay marking, and nothing at all about handwritten maths. An
 * even spread across level, subject and regime is both cheaper and more
 * informative than a larger unstratified draw.
 */

export type EvaluationBudget = {
  /** Hard ceiling on responses marked in one run. */
  maxRecords: number;
  /** Cap per level/subject/regime bucket, so no one bucket dominates. */
  perStratum: number;
  /** Refuse to start if the estimate exceeds this. */
  maxEstimatedUsd: number;
};

export const DEFAULT_EVALUATION_BUDGET: EvaluationBudget = {
  // Deliberately small. A first run should be cheap enough to be boring, and
  // widening it is a flag rather than a default.
  maxRecords: 120,
  perStratum: 8,
  maxEstimatedUsd: 5,
};

export type EvaluationPlan = {
  records: MarkingCorpusRecord[];
  strata: {
    key: string;
    level: MarkingLevel;
    subject: string;
    regime: MarkingRegime;
    available: number;
    selected: number;
  }[];
  estimate: EvaluationEstimate;
  /** Buckets dropped because the record ceiling was reached first. */
  omittedStrata: string[];
};

export type EvaluationEstimate = {
  records: number;
  /** Marking is a blind pair plus adjudication when they disagree. */
  estimatedCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedUsd: number;
};

export type TokenPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

/** Deliberately pessimistic; an estimate that flatters is worse than none. */
export const DEFAULT_PRICING: TokenPricing = {
  inputUsdPerMillion: 0.6,
  outputUsdPerMillion: 2.4,
};

function stratumKey(record: MarkingCorpusRecord) {
  return `${record.level}/${record.subject}/${record.regime}`;
}

/**
 * A small deterministic generator, so a run is reproducible and its results
 * can be cached and compared against the next one. `Math.random` would make
 * every run a different sample and every comparison meaningless.
 */
function seededRandom(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function estimateTokens(record: MarkingCorpusRecord) {
  const promptCharacters =
    record.questionPrompt.length + (record.markScheme?.length ?? 0);
  const answerCharacters =
    record.answer.kind === "text" ? record.answer.text.length : 0;
  // A page image costs far more than its text would. This is a coarse figure
  // chosen to overstate rather than understate.
  const imageTokens =
    record.answer.kind === "image" ? record.answer.paths.length * 1_600 : 0;
  const input = Math.ceil((promptCharacters + answerCharacters) / 3.5) + imageTokens;
  const output = Math.ceil(record.maxMarks * 120) + 400;
  return { input, output };
}

export function estimateEvaluationCost(
  records: readonly MarkingCorpusRecord[],
  pricing: TokenPricing = DEFAULT_PRICING
): EvaluationEstimate {
  let input = 0;
  let output = 0;
  for (const record of records) {
    const tokens = estimateTokens(record);
    input += tokens.input;
    output += tokens.output;
  }
  // Two blind markers always, plus an adjudication on a pessimistic third of
  // responses. Rejected reports and re-marks are not modelled; treat the
  // figure as a floor, not a promise.
  const callsPerRecord = 2.35;
  const scaledInput = Math.ceil(input * callsPerRecord);
  const scaledOutput = Math.ceil(output * callsPerRecord);
  return {
    records: records.length,
    estimatedCalls: Math.ceil(records.length * callsPerRecord),
    estimatedInputTokens: scaledInput,
    estimatedOutputTokens: scaledOutput,
    estimatedUsd:
      (scaledInput / 1_000_000) * pricing.inputUsdPerMillion +
      (scaledOutput / 1_000_000) * pricing.outputUsdPerMillion,
  };
}

export function planEvaluation(input: {
  records: readonly MarkingCorpusRecord[];
  budget?: Partial<EvaluationBudget>;
  pricing?: TokenPricing;
  seed?: string;
}): EvaluationPlan {
  const budget = { ...DEFAULT_EVALUATION_BUDGET, ...input.budget };
  const random = seededRandom(input.seed ?? "jami-evaluation");

  const buckets = new Map<string, MarkingCorpusRecord[]>();
  for (const record of input.records) {
    const key = stratumKey(record);
    const existing = buckets.get(key);
    if (existing) existing.push(record);
    else buckets.set(key, [record]);
  }

  // Round-robin across buckets rather than filling each in turn, so hitting
  // the ceiling thins every stratum evenly instead of starving whichever
  // subjects happen to sort last.
  const queues = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, records]) => ({
      key,
      remaining: shuffled(records, random).slice(0, budget.perStratum),
      available: records.length,
      selected: 0,
    }));

  const selected: MarkingCorpusRecord[] = [];
  let exhausted = false;
  while (!exhausted && selected.length < budget.maxRecords) {
    exhausted = true;
    for (const queue of queues) {
      if (selected.length >= budget.maxRecords) break;
      const next = queue.remaining.shift();
      if (!next) continue;
      exhausted = false;
      selected.push(next);
      queue.selected += 1;
    }
  }

  const strata = queues.map((queue) => {
    const [level, subject, regime] = queue.key.split("/");
    return {
      key: queue.key,
      level: level as MarkingLevel,
      subject,
      regime: regime as MarkingRegime,
      available: queue.available,
      selected: queue.selected,
    };
  });

  return {
    records: selected,
    strata,
    estimate: estimateEvaluationCost(selected, input.pricing),
    omittedStrata: strata.filter((stratum) => stratum.selected === 0).map((s) => s.key),
  };
}

/**
 * The guard a runner must pass before spending anything. Returns the reason it
 * refuses, or null when the plan is within budget.
 */
export function budgetRefusal(
  plan: EvaluationPlan,
  budget: Partial<EvaluationBudget> = {}
): string | null {
  const limits = { ...DEFAULT_EVALUATION_BUDGET, ...budget };
  if (plan.records.length === 0) return "No records selected; nothing to evaluate.";
  if (plan.estimate.estimatedUsd > limits.maxEstimatedUsd) {
    return `Estimated ${plan.estimate.estimatedUsd.toFixed(2)} USD exceeds the ${limits.maxEstimatedUsd.toFixed(2)} USD ceiling. Narrow the sample or raise the ceiling deliberately.`;
  }
  return null;
}
