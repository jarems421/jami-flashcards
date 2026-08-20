/**
 * Agreement between two markers over the same work.
 *
 * The headline metric is quadratic weighted kappa, which is what the automated
 * scoring literature reports, so Jami's figures can be read against published
 * ones directly. It scores 0 for chance agreement and 1 for perfect, goes
 * negative for systematic disagreement, and penalises being badly wrong far
 * more than being slightly wrong -- three marks out on a five-mark question is
 * nine times the penalty of one.
 *
 * The trap this module exists to avoid: kappa is only meaningful on a single
 * ordinal scale. Pooling a three-mark question and a twenty-mark question into
 * one confusion matrix silently invents a scale neither of them uses. So the
 * unit of measurement here is always one question, and aggregate figures are
 * built from per-question kappas rather than from pooled marks.
 */

export type MarkPair = {
  questionId: string;
  maxMarks: number;
  /** The mark a human awarded. */
  reference: number;
  /** The mark under test. */
  candidate: number;
  /**
   * The smallest mark increment this question uses. Real schemes award halves,
   * and rounding them away turns a five-point scale (0, .5, 1, 1.5, 2) into a
   * three-point one, quietly discarding exactly the partial credit this whole
   * system exists to measure. Defaults to whole marks.
   */
  step?: number;
};

export type AgreementSummary = {
  /** Quadratic weighted kappa; null when the sample cannot support one. */
  kappa: number | null;
  /** Share of marks that match exactly. */
  exact: number;
  /** Share of marks within one mark. */
  adjacent: number;
  /** Mean signed error. Positive means the candidate marks more generously. */
  bias: number;
  /** Mean absolute error, in marks. */
  meanAbsoluteError: number;
  count: number;
};

/**
 * A mark as a whole number of steps up the scale. A 2-mark question awarded in
 * halves becomes 0..4, so half marks survive rather than being rounded away.
 */
function clampToScale(value: number, maxMarks: number, step = 1) {
  const increment = step > 0 ? step : 1;
  if (!Number.isFinite(value)) return 0;
  const steps = Math.round(value / increment);
  return Math.max(0, Math.min(Math.round(maxMarks / increment), steps));
}

function scaleStepsFor(pairs: readonly Pick<MarkPair, "step">[]) {
  const steps = pairs.map((pair) => pair.step).filter((step): step is number => Boolean(step && step > 0));
  return steps.length > 0 ? Math.min(...steps) : 1;
}

/**
 * Kappa for one question, where every pair shares a scale of 0..maxMarks.
 *
 * Returns null for a sample too small or too uniform to say anything: with
 * fewer than two pairs there is nothing to agree about, and when every rating
 * from both markers is identical the expected-disagreement denominator is zero
 * and kappa is undefined rather than perfect.
 */
export function quadraticWeightedKappa(
  pairs: readonly Pick<MarkPair, "reference" | "candidate" | "step">[],
  maxMarks: number
): number | null {
  if (pairs.length < 2 || maxMarks < 1) return null;

  const step = scaleStepsFor(pairs);
  const points = Math.round(maxMarks / step);
  const size = points + 1;
  const observed = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const referenceTotals = new Array<number>(size).fill(0);
  const candidateTotals = new Array<number>(size).fill(0);

  for (const pair of pairs) {
    const reference = clampToScale(pair.reference, maxMarks, step);
    const candidate = clampToScale(pair.candidate, maxMarks, step);
    observed[reference][candidate] += 1;
    referenceTotals[reference] += 1;
    candidateTotals[candidate] += 1;
  }

  const total = pairs.length;
  const denominator = points ** 2;
  let observedWeighted = 0;
  let expectedWeighted = 0;

  for (let reference = 0; reference < size; reference += 1) {
    for (let candidate = 0; candidate < size; candidate += 1) {
      const weight = ((reference - candidate) ** 2) / denominator;
      observedWeighted += weight * observed[reference][candidate];
      expectedWeighted +=
        weight * ((referenceTotals[reference] * candidateTotals[candidate]) / total);
    }
  }

  if (expectedWeighted === 0) return null;
  return 1 - observedWeighted / expectedWeighted;
}

/**
 * Agreement across a mixed set of questions.
 *
 * Kappa is computed per question and then averaged over the questions that
 * could support one, so a long question with a wide scale does not dominate a
 * short one. The other figures pool cleanly and are reported over every pair.
 */
export function summariseAgreement(pairs: readonly MarkPair[]): AgreementSummary {
  if (pairs.length === 0) {
    return {
      kappa: null,
      exact: 0,
      adjacent: 0,
      bias: 0,
      meanAbsoluteError: 0,
      count: 0,
    };
  }

  const byQuestion = new Map<string, MarkPair[]>();
  for (const pair of pairs) {
    const existing = byQuestion.get(pair.questionId);
    if (existing) existing.push(pair);
    else byQuestion.set(pair.questionId, [pair]);
  }

  const kappas: number[] = [];
  for (const [, questionPairs] of byQuestion) {
    const kappa = quadraticWeightedKappa(
      questionPairs,
      questionPairs[0].maxMarks
    );
    if (kappa !== null) kappas.push(kappa);
  }

  let exact = 0;
  let adjacent = 0;
  let signedError = 0;
  let absoluteError = 0;
  for (const pair of pairs) {
    const step = pair.step && pair.step > 0 ? pair.step : 1;
    const reference = clampToScale(pair.reference, pair.maxMarks, step) * step;
    const candidate = clampToScale(pair.candidate, pair.maxMarks, step) * step;
    const difference = candidate - reference;
    if (difference === 0) exact += 1;
    // "Adjacent" means one step on this question's own scale, so a half-mark
    // question is not silently credited for being a whole mark out.
    if (Math.abs(difference) <= step) adjacent += 1;
    signedError += difference;
    absoluteError += Math.abs(difference);
  }

  return {
    kappa: kappas.length > 0
      ? kappas.reduce((total, value) => total + value, 0) / kappas.length
      : null,
    exact: exact / pairs.length,
    adjacent: adjacent / pairs.length,
    bias: signedError / pairs.length,
    meanAbsoluteError: absoluteError / pairs.length,
    count: pairs.length,
  };
}

/**
 * How the candidate's marks are spread across the scale, as a share per band.
 *
 * LLM markers are known to compress toward the middle and to skew generous, and
 * both distortions are invisible in an average. Comparing this against the
 * reference distribution is what makes central tendency measurable rather than
 * suspected.
 */
export function markDistribution(
  pairs: readonly MarkPair[],
  select: "reference" | "candidate",
  bands = 5
): number[] {
  const counts = new Array<number>(bands).fill(0);
  if (pairs.length === 0) return counts;
  for (const pair of pairs) {
    const step = pair.step && pair.step > 0 ? pair.step : 1;
    const value = clampToScale(pair[select], pair.maxMarks, step) * step;
    const share = pair.maxMarks === 0 ? 0 : value / pair.maxMarks;
    const band = Math.min(bands - 1, Math.floor(share * bands));
    counts[band] += 1;
  }
  return counts.map((count) => count / pairs.length);
}

/**
 * What two humans marking the same work actually agree on.
 *
 * This exists because a percentage without a ceiling is unreadable. Jami's 53%
 * exact agreement on Higher Maths looked catastrophic for a week, and the
 * corpus held the answer the whole time: on 240 double-marked GCSE maths
 * answers, two human markers agree exactly 72% of the time, and only 67-70% at
 * the three and four mark tariffs that match. A perfect marker cannot score far
 * above that against any *single* examiner, because that examiner's own
 * colleague disagrees with them a third of the time.
 *
 * `bias` is the figure that turned out to matter. Two humans disagree by 0.40
 * marks on average and in no direction at all -- 31 one way, 36 the other, mean
 * -0.025. Jami disagrees by a comparable 0.61 and almost entirely upward. Human
 * marking is noisy; Jami's is skewed, and those are different faults with
 * different fixes.
 *
 * Derived from whatever double-marked records are held rather than written down
 * as a constant, so it improves when the corpus does and cannot quietly go
 * stale. Returns null where nothing in the selection carries two markers.
 */
export type HumanBenchmark = {
  /** Records where two or more humans marked the same answer. */
  count: number;
  /** Share where they landed on exactly the same mark. */
  exact: number;
  /** Mean absolute distance between them, in marks. */
  meanGap: number;
  /**
   * Mean signed distance, first marker minus second. Near zero means they are
   * noisy about each other rather than one being systematically harsher.
   */
  bias: number;
  /** Mean tariff, since agreement falls sharply as questions get longer. */
  meanMaxMarks: number;
};

export function humanBenchmark(
  records: readonly { humanMarks: readonly number[]; maxMarks: number; subject?: string }[],
  filter: { subject?: string; minMaxMarks?: number; maxMaxMarks?: number } = {}
): HumanBenchmark | null {
  const doubled = records.filter(
    (record) =>
      record.humanMarks.length > 1 &&
      (filter.subject === undefined || record.subject === filter.subject) &&
      (filter.minMaxMarks === undefined || record.maxMarks >= filter.minMaxMarks) &&
      (filter.maxMaxMarks === undefined || record.maxMarks <= filter.maxMaxMarks)
  );
  if (doubled.length === 0) return null;

  let exact = 0;
  let gap = 0;
  let signed = 0;
  let tariff = 0;
  for (const record of doubled) {
    // The first two markers, because a third would need a convention for which
    // pair to measure and no source here supplies one.
    const [first, second] = record.humanMarks;
    if (first === second) exact += 1;
    gap += Math.abs(first - second);
    signed += first - second;
    tariff += record.maxMarks;
  }
  return {
    count: doubled.length,
    exact: exact / doubled.length,
    meanGap: gap / doubled.length,
    bias: signed / doubled.length,
    meanMaxMarks: tariff / doubled.length,
  };
}
