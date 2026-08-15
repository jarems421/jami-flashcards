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

function clampToScale(value: number, maxMarks: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maxMarks, Math.round(value)));
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
  pairs: readonly Pick<MarkPair, "reference" | "candidate">[],
  maxMarks: number
): number | null {
  if (pairs.length < 2 || maxMarks < 1) return null;

  const size = maxMarks + 1;
  const observed = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const referenceTotals = new Array<number>(size).fill(0);
  const candidateTotals = new Array<number>(size).fill(0);

  for (const pair of pairs) {
    const reference = clampToScale(pair.reference, maxMarks);
    const candidate = clampToScale(pair.candidate, maxMarks);
    observed[reference][candidate] += 1;
    referenceTotals[reference] += 1;
    candidateTotals[candidate] += 1;
  }

  const total = pairs.length;
  const denominator = (maxMarks) ** 2;
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
    const reference = clampToScale(pair.reference, pair.maxMarks);
    const candidate = clampToScale(pair.candidate, pair.maxMarks);
    const difference = candidate - reference;
    if (difference === 0) exact += 1;
    if (Math.abs(difference) <= 1) adjacent += 1;
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
    const value = clampToScale(pair[select], pair.maxMarks);
    const share = pair.maxMarks === 0 ? 0 : value / pair.maxMarks;
    const band = Math.min(bands - 1, Math.floor(share * bands));
    counts[band] += 1;
  }
  return counts.map((count) => count / pairs.length);
}
