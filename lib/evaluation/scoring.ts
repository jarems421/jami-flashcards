import type { MarkingCorpusRecord, MarkingCriterion } from "@/lib/evaluation/marking-corpus";

/**
 * Scoring one marked response against the humans who marked it.
 *
 * The judgement this module is built around: where two examiners disagree,
 * neither of them is the truth. On a 20-mark essay the Medly examiners are 4.6
 * marks apart on average; forcing Jami to match examiner 1 exactly would score
 * it against a number examiner 2 already rejected, and would call a mark of 7
 * wrong when the humans said 6 and 8 — even though 7 is the best available
 * answer and better calibrated than either human.
 *
 * So a double-marked response is scored three ways and all three are reported:
 * against each examiner individually, against their consensus, and against the
 * interval between them. The last is the one that says whether Jami is inside
 * human variation, which is the only bar that means anything when the humans
 * themselves do not agree.
 *
 * Single-marked responses have no interval, so their interval fields are null
 * rather than zero. Reporting a missing measurement as a perfect one would
 * flatter every source that could not supply a second marker.
 */

export type MarkOutcome = {
  recordId: string;
  sourceId: string;
  level: string;
  subject: string;
  regime: string;
  questionId: string;
  maxMarks: number;
  humanMarks: readonly number[];
  candidate: number;

  /** Error against each human, in the order they were recorded. */
  perMarkerError: number[];
  /** Distance from the mean of the humans. */
  consensusError: number;
  /** As a share of the question's tariff, so questions of any size compare. */
  normalisedConsensusError: number;
  exactAgainstAny: boolean;
  exactAgainstAll: boolean;
  withinOneOfAny: boolean;

  /** Null when only one human marked it. */
  humanSpread: number | null;
  /** Inside the closed interval between the two humans. */
  insideHumanInterval: boolean | null;
  /**
   * Distance outside the human interval; zero when inside. This is the honest
   * error when the humans disagree — being between two examiners is not a
   * mistake.
   */
  intervalError: number | null;
  /**
   * Whether Jami sits no further from the consensus than the humans sit from
   * each other. The bar for "as good as a human marker on this response".
   */
  withinHumanVariation: boolean | null;

  /** Present only where both sides carry criteria. */
  criterion: CriterionOutcome | null;
};

/**
 * One mark, and what each side decided about it.
 *
 * The counts below say how many marks agreed; this says which. Two things need
 * that. A paired comparison between runs has to line up mark against mark, and
 * a count of four out of seven cannot be lined up with anything. And a person
 * asking why a mark was lost is asking about a specific mark — answering from
 * the counts alone means inferring Jami's decisions from its total, which only
 * works when the total is unanimous.
 */
export type CriterionCall = {
  /** The scheme's own identifier for the mark, e.g. `Mark 3`. */
  id: string;
  /** Whether the examiner awarded it. */
  human: boolean;
  /** Whether Jami awarded it, or null where Jami never addressed this mark. */
  jami: boolean | null;
};

export type CriterionOutcome = {
  /** Criteria the human ruled on and Jami also addressed. */
  compared: number;
  /** Of those, how many Jami awarded or withheld the same way. */
  agreed: number;
  /** Criteria the human ruled on that Jami never mentioned. */
  missed: number;
  /** Criteria Jami invented that the human did not rule on. */
  extra: number;
  /**
   * The right total by the right route: the mark matches a human's *and* every
   * compared criterion agrees. A total can be reached by luck; this cannot.
   */
  rightForTheRightReasons: boolean;
  /**
   * Every mark the examiner ruled on, in the order the source published them.
   *
   * Marks Jami invented are not here — they have no examiner decision to sit
   * beside — and are counted in `extra` instead.
   */
  calls: CriterionCall[];
};

const mean = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0) / values.length;

/** Loose comparison of criterion labels, which are prose and rarely identical. */
function normaliseLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Match Jami's criteria to the scheme's.
 *
 * Matched by identifier first, since a source like Qualifications Scotland
 * numbers its marks, and by description only as a fallback. Anything unmatched
 * is counted rather than dropped: a marker that addresses three of six marks
 * and gets all three right is not a marker that agrees with the examiner.
 */
export function compareCriteria(
  human: readonly MarkingCriterion[],
  candidate: readonly { criterionId?: string; criterion: string; awarded: boolean }[],
  marksAgree: boolean
): CriterionOutcome {
  const remaining = [...candidate];
  const calls: CriterionCall[] = [];
  let compared = 0;
  let agreed = 0;
  let missed = 0;

  for (const [position, criterion] of human.entries()) {
    /**
     * The scheme's own numbering first, prose only as a fallback.
     *
     * Both markers are handed the criteria as `C1`, `C2`, ... in the order the
     * source published them, so `C{n}` is the nth human criterion by
     * construction. Matching on wording instead is what made two markers
     * describing the same criterion look like a disagreement, and it would do
     * the same here between a model's phrasing and an examiner's.
     */
    const schemeId = `c${position + 1}`;
    const id = normaliseLabel(criterion.id);
    const description = criterion.description ? normaliseLabel(criterion.description) : null;

    let index = remaining.findIndex(
      (entry) => entry.criterionId && normaliseLabel(entry.criterionId) === schemeId
    );
    if (index === -1) {
      index = remaining.findIndex((entry) => {
        const label = normaliseLabel(entry.criterion);
        return label.includes(id) || (description !== null && label.includes(description));
      });
    }
    const awardedByHuman = criterion.awarded > 0;
    if (index === -1) {
      missed += 1;
      calls.push({ id: criterion.id, human: awardedByHuman, jami: null });
      continue;
    }
    const [matched] = remaining.splice(index, 1);
    compared += 1;
    if (matched.awarded === awardedByHuman) agreed += 1;
    calls.push({ id: criterion.id, human: awardedByHuman, jami: matched.awarded });
  }

  return {
    compared,
    agreed,
    missed,
    extra: remaining.length,
    rightForTheRightReasons: marksAgree && missed === 0 && compared > 0 && agreed === compared,
    calls,
  };
}

export function scoreMark(input: {
  record: MarkingCorpusRecord;
  candidate: number;
  criteria?: readonly { criterionId?: string; criterion: string; awarded: boolean }[];
}): MarkOutcome {
  const { record, candidate } = input;
  const humans = record.humanMarks;
  const perMarkerError = humans.map((human) => Math.abs(candidate - human));
  const consensus = mean(humans);
  const consensusError = Math.abs(candidate - consensus);

  const spread = humans.length > 1 ? Math.max(...humans) - Math.min(...humans) : null;
  const inside =
    humans.length > 1
      ? candidate >= Math.min(...humans) && candidate <= Math.max(...humans)
      : null;
  const intervalError =
    humans.length > 1
      ? inside
        ? 0
        : Math.min(...perMarkerError)
      : null;
  // Each human sits half the spread from their own consensus, so that is the
  // distance Jami is allowed before it is doing worse than they did.
  const withinHumanVariation = spread === null ? null : consensusError <= spread / 2;

  const marksAgree = perMarkerError.some((error) => error === 0);
  const criterion =
    record.criteria && input.criteria
      ? compareCriteria(record.criteria, input.criteria, marksAgree)
      : null;

  return {
    recordId: record.id,
    sourceId: record.sourceId,
    level: record.level,
    subject: record.subject,
    regime: record.regime,
    questionId: record.questionId,
    maxMarks: record.maxMarks,
    humanMarks: humans,
    candidate,
    perMarkerError,
    consensusError,
    normalisedConsensusError: record.maxMarks > 0 ? consensusError / record.maxMarks : 0,
    exactAgainstAny: marksAgree,
    exactAgainstAll: perMarkerError.every((error) => error === 0),
    withinOneOfAny: perMarkerError.some((error) => error <= 1),
    humanSpread: spread,
    insideHumanInterval: inside,
    intervalError,
    withinHumanVariation,
    criterion,
  };
}

export type OutcomeSummary = {
  count: number;
  /** Matches at least one human exactly. */
  exact: number;
  /** Matches every human exactly. Only differs where there are two. */
  exactAll: number;
  withinOne: number;
  meanAbsoluteError: number;
  /** Mean |candidate - consensus| / maxMarks, comparable across tariffs. */
  normalisedError: number;
  /** Positive means Jami marks more generously than the humans. */
  bias: number;

  doubleMarked: number;
  /** Mean gap between the two humans, over double-marked responses. */
  humanDisagreement: number | null;
  /** Mean distance from Jami to the human consensus, over the same responses. */
  candidateDisagreement: number | null;
  insideHumanInterval: number | null;
  withinHumanVariation: number | null;

  criterionCompared: number;
  criterionAgreement: number | null;
  rightForTheRightReasons: number | null;
};

export function summariseOutcomes(outcomes: readonly MarkOutcome[]): OutcomeSummary {
  const empty: OutcomeSummary = {
    count: 0,
    exact: 0,
    exactAll: 0,
    withinOne: 0,
    meanAbsoluteError: 0,
    normalisedError: 0,
    bias: 0,
    doubleMarked: 0,
    humanDisagreement: null,
    candidateDisagreement: null,
    insideHumanInterval: null,
    withinHumanVariation: null,
    criterionCompared: 0,
    criterionAgreement: null,
    rightForTheRightReasons: null,
  };
  if (outcomes.length === 0) return empty;

  const share = (count: number) => count / outcomes.length;
  const doubles = outcomes.filter((outcome) => outcome.humanSpread !== null);
  const withCriteria = outcomes.filter((outcome) => (outcome.criterion?.compared ?? 0) > 0);

  const criterionCompared = withCriteria.reduce(
    (total, outcome) => total + (outcome.criterion?.compared ?? 0),
    0
  );
  const criterionAgreed = withCriteria.reduce(
    (total, outcome) => total + (outcome.criterion?.agreed ?? 0),
    0
  );

  return {
    count: outcomes.length,
    exact: share(outcomes.filter((outcome) => outcome.exactAgainstAny).length),
    exactAll: share(outcomes.filter((outcome) => outcome.exactAgainstAll).length),
    withinOne: share(outcomes.filter((outcome) => outcome.withinOneOfAny).length),
    meanAbsoluteError: mean(outcomes.map((outcome) => Math.min(...outcome.perMarkerError))),
    normalisedError: mean(outcomes.map((outcome) => outcome.normalisedConsensusError)),
    bias: mean(outcomes.map((outcome) => outcome.candidate - mean(outcome.humanMarks))),
    doubleMarked: doubles.length,
    humanDisagreement: doubles.length > 0 ? mean(doubles.map((o) => o.humanSpread ?? 0)) : null,
    candidateDisagreement: doubles.length > 0 ? mean(doubles.map((o) => o.consensusError)) : null,
    insideHumanInterval:
      doubles.length > 0
        ? doubles.filter((outcome) => outcome.insideHumanInterval).length / doubles.length
        : null,
    withinHumanVariation:
      doubles.length > 0
        ? doubles.filter((outcome) => outcome.withinHumanVariation).length / doubles.length
        : null,
    criterionCompared,
    criterionAgreement: criterionCompared > 0 ? criterionAgreed / criterionCompared : null,
    rightForTheRightReasons:
      withCriteria.length > 0
        ? withCriteria.filter((outcome) => outcome.criterion?.rightForTheRightReasons).length /
          withCriteria.length
        : null,
  };
}

/** Summaries split by a facet, so a gain in one subject cannot hide a loss elsewhere. */
export function summariseBy(
  outcomes: readonly MarkOutcome[],
  facet: (outcome: MarkOutcome) => string
) {
  const buckets = new Map<string, MarkOutcome[]>();
  for (const outcome of outcomes) {
    const key = facet(outcome);
    const existing = buckets.get(key);
    if (existing) existing.push(outcome);
    else buckets.set(key, [outcome]);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => ({ key, summary: summariseOutcomes(group) }));
}
