import type { MarkOutcome } from "@/lib/evaluation/scoring";

/**
 * Marking accuracy split by board and subject, with the uncertainty attached.
 *
 * A single headline hides the case that matters: a marker that is excellent on
 * Pearson maths and poor on AQA History averages to "fine". Splitting it up
 * creates the opposite risk, cells of eight answers read as findings, so every
 * share carries a 95% interval and a cell below `MIN_REPORTABLE` says so
 * instead of offering a number to quote.
 */

/** Fewer answers than this and a cell's interval is too wide to quote. */
export const MIN_REPORTABLE = 20;

export type Interval = { low: number; high: number };

/** Wilson score interval for k successes in n, which behaves near 0% and 100%. */
export function wilsonInterval(successes: number, total: number, z = 1.96): Interval | null {
  if (total <= 0) return null;
  const p = successes / total;
  const z2 = z * z;
  const centre = (p + z2 / (2 * total)) / (1 + z2 / total);
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / (1 + z2 / total);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Normal interval for a mean, adequate at the sample sizes a cell is reported at. */
export function meanInterval(values: readonly number[], z = 1.96): Interval | null {
  if (values.length < 2) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  const half = z * Math.sqrt(variance / values.length);
  return { low: mean - half, high: mean + half };
}

export type BreakdownRow = {
  key: string;
  answers: number;
  /** Total marks available across the answers. */
  marksAvailable: number;
  /** Jami's total equals the examiner's. */
  exact: number;
  exactInterval: Interval | null;
  /** Jami's total is within one mark of the examiner's. */
  withinOne: number;
  withinOneInterval: Interval | null;
  /**
   * 1 - (marks Jami and the examiner differ by) / (marks available): the share
   * of the paper's marks they agree on. Comparable across tariffs, unlike a
   * mean error in marks.
   */
  markAgreement: number;
  /** Mean (Jami - examiner) per answer; positive is generous. */
  bias: number;
  biasInterval: Interval | null;
  /** Mean |Jami - examiner| as a share of the question's tariff. */
  normalisedError: number;
  reportable: boolean;
};

const examiner = (outcome: MarkOutcome) =>
  outcome.humanMarks.reduce((total, mark) => total + mark, 0) / Math.max(1, outcome.humanMarks.length);

export function breakdownRow(key: string, outcomes: readonly MarkOutcome[]): BreakdownRow {
  const answers = outcomes.length;
  const exactCount = outcomes.filter((outcome) => outcome.exactAgainstAny).length;
  const withinOneCount = outcomes.filter((outcome) => outcome.withinOneOfAny).length;
  const marksAvailable = outcomes.reduce((total, outcome) => total + outcome.maxMarks, 0);
  const differences = outcomes.map((outcome) => outcome.candidate - examiner(outcome));
  const marksApart = differences.reduce((total, difference) => total + Math.abs(difference), 0);
  const mean = (values: readonly number[]) =>
    values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
  return {
    key,
    answers,
    marksAvailable,
    exact: answers ? exactCount / answers : 0,
    exactInterval: wilsonInterval(exactCount, answers),
    withinOne: answers ? withinOneCount / answers : 0,
    withinOneInterval: wilsonInterval(withinOneCount, answers),
    markAgreement: marksAvailable ? 1 - marksApart / marksAvailable : 0,
    bias: mean(differences),
    biasInterval: meanInterval(differences),
    normalisedError: mean(outcomes.map((outcome) => outcome.normalisedConsensusError)),
    reportable: answers >= MIN_REPORTABLE,
  };
}

/**
 * How often two examiners agree with each other on the same answer.
 *
 * A marker's exact-agreement rate is unreadable without this: on a 9-mark
 * extended answer two qualified examiners land on the same mark well under
 * half the time, and a marker cannot be expected to agree with one examiner
 * more often than a second examiner does. Measured on double-marked answers,
 * treating the first examiner as the reference and the second as the marker,
 * so the figures are directly comparable with `breakdownRow`.
 */
export function examinerCeiling(
  key: string,
  answers: readonly { firstMark: number; secondMark: number; maxMarks: number }[]
): BreakdownRow {
  const differences = answers.map((answer) => answer.secondMark - answer.firstMark);
  const exactCount = differences.filter((difference) => difference === 0).length;
  const withinOneCount = differences.filter((difference) => Math.abs(difference) <= 1).length;
  const marksAvailable = answers.reduce((total, answer) => total + answer.maxMarks, 0);
  const marksApart = differences.reduce((total, difference) => total + Math.abs(difference), 0);
  const count = answers.length;
  return {
    key,
    answers: count,
    marksAvailable,
    exact: count ? exactCount / count : 0,
    exactInterval: wilsonInterval(exactCount, count),
    withinOne: count ? withinOneCount / count : 0,
    withinOneInterval: wilsonInterval(withinOneCount, count),
    markAgreement: marksAvailable ? 1 - marksApart / marksAvailable : 0,
    bias: count ? differences.reduce((total, difference) => total + difference, 0) / count : 0,
    biasInterval: meanInterval(differences),
    normalisedError: count
      ? answers.reduce((total, answer) => total + Math.abs(answer.secondMark - answer.firstMark) / Math.max(1, answer.maxMarks), 0) / count
      : 0,
    reportable: count >= MIN_REPORTABLE,
  };
}

/** One row per value of `facet`, largest first, so the best-evidenced cells lead. */
export function breakdownBy(
  outcomes: readonly MarkOutcome[],
  facet: (outcome: MarkOutcome) => string | null
): BreakdownRow[] {
  const groups = new Map<string, MarkOutcome[]>();
  for (const outcome of outcomes) {
    const key = facet(outcome);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), outcome]);
  }
  return [...groups.entries()]
    .map(([key, group]) => breakdownRow(key, group))
    .sort((left, right) => right.answers - left.answers || left.key.localeCompare(right.key));
}
