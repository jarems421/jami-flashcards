import type { MarkingCorpusRecord, MarkingCorpusSource } from "@/lib/evaluation/marking-corpus";
import { exemplarRefusal, groupKey } from "./holdout.ts";

/**
 * The four arms of the exemplar experiment.
 *
 * The question this exists to answer is whether showing the model examples of
 * marked work actually helps, and if so which examples. That is not obvious:
 * exemplars cost tokens on every call, and a badly chosen one may anchor the
 * model on the wrong tariff or the wrong marking style. So the arms are ordered
 * by how much they claim, and the experiment is only worth running because a
 * null result — B, C and D no better than A — is a real and useful answer.
 *
 *   A  none              the control
 *   B  generic           any marked work at all
 *   C  regime            marked the same way
 *   D  matched           same subject, level and regime
 *
 * Every arm draws from the same pool, which has already had the benchmark and
 * the uncleared licences removed. Selection then re-checks each candidate
 * through the same guard the production retrieval path would use, because a
 * pool built once and trusted forever is exactly how a leak survives.
 */

export type ExemplarArm = "none" | "generic" | "regime" | "matched";

export const EXEMPLAR_ARMS: readonly ExemplarArm[] = ["none", "generic", "regime", "matched"];

export const ARM_LABELS: Record<ExemplarArm, string> = {
  none: "A no exemplars",
  generic: "B generic exemplars",
  regime: "C regime-matched",
  matched: "D subject, level and regime matched",
};

export type ArmSelection = {
  arm: ExemplarArm;
  exemplars: MarkingCorpusRecord[];
  /**
   * Why the arm could not be filled. An arm that silently falls back to a
   * looser match would make C and D indistinguishable from B and quietly
   * invalidate the comparison.
   */
  shortfall: string | null;
};

function stableOrder(records: readonly MarkingCorpusRecord[], seed: string) {
  const score = (record: MarkingCorpusRecord) => {
    let hash = 2166136261;
    const key = `${seed}:${record.id}`;
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };
  return [...records].sort((left, right) => score(left) - score(right));
}

/**
 * The eligible pool, in a fixed order, computed once per pool and benchmark.
 *
 * Every eligibility rule except "not the question under test" depends only on
 * the pool and the benchmark, so recomputing them for each of several thousand
 * targets turns a linear job into a quadratic one — the first version of this
 * took long enough that it looked like a hang rather than a slow function.
 * Cached against the array identities, so a caller that reuses its arrays pays
 * once and a caller that builds new ones is never handed a stale answer.
 */
const poolCache = new WeakMap<
  object,
  WeakMap<object, Map<string, readonly MarkingCorpusRecord[]>>
>();

function eligiblePool(input: {
  pool: readonly MarkingCorpusRecord[];
  benchmark: readonly MarkingCorpusRecord[];
  seed: string;
  sourceFor?: (sourceId: string) => MarkingCorpusSource | undefined;
}) {
  const byPool = poolCache.get(input.benchmark) ?? new WeakMap();
  poolCache.set(input.benchmark, byPool);
  const bySeed = byPool.get(input.pool) ?? new Map();
  byPool.set(input.pool, bySeed);

  const cached = bySeed.get(input.seed);
  if (cached) return cached;

  const eligible = stableOrder(
    input.pool.filter((record) => exemplarRefusal(record, input.benchmark, input.sourceFor) === null),
    input.seed
  );
  bySeed.set(input.seed, eligible);
  return eligible as readonly MarkingCorpusRecord[];
}

const kindOf = (record: MarkingCorpusRecord) =>
  `${record.level}/${record.subject}/${record.regime}`;

/** Already ordered, so the first matches are deterministic. Stops when full. */
function takeFirst(
  ordered: readonly MarkingCorpusRecord[],
  matches: (record: MarkingCorpusRecord) => boolean,
  count: number
) {
  const chosen: MarkingCorpusRecord[] = [];
  for (const record of ordered) {
    if (chosen.length >= count) break;
    if (matches(record)) chosen.push(record);
  }
  return chosen;
}

/**
 * One from each kind of marked work in turn, rather than the first few of a
 * fixed order.
 *
 * "Generic" has to mean a spread, or it does not mean anything. Nine tenths of
 * the cleared pool is banded marking, so taking the first three of any single
 * ordering hands the generic arm three banded exemplars and makes it a copy of
 * the regime-matched arm — the two then score identically and appear to prove
 * that matching does not matter, when in fact nothing was varied. Round-robin
 * across level/subject/regime is what keeps the control honest.
 */
function spreadAcrossKinds(ordered: readonly MarkingCorpusRecord[], count: number) {
  const byKind = new Map<string, MarkingCorpusRecord[]>();
  for (const record of ordered) {
    const kind = kindOf(record);
    const existing = byKind.get(kind);
    if (existing) existing.push(record);
    else byKind.set(kind, [record]);
  }

  const queues = [...byKind.keys()].sort().map((kind) => byKind.get(kind) ?? []);
  const chosen: MarkingCorpusRecord[] = [];
  for (let round = 0; chosen.length < count; round += 1) {
    let added = false;
    for (const queue of queues) {
      if (chosen.length >= count) break;
      const next = queue[round];
      if (!next) continue;
      chosen.push(next);
      added = true;
    }
    if (!added) break;
  }
  return chosen;
}

export function selectExemplars(input: {
  arm: ExemplarArm;
  target: MarkingCorpusRecord;
  pool: readonly MarkingCorpusRecord[];
  benchmark: readonly MarkingCorpusRecord[];
  count?: number;
  seed?: string;
  sourceFor?: (sourceId: string) => MarkingCorpusSource | undefined;
}): ArmSelection {
  const { arm, target } = input;
  const count = input.count ?? 3;
  if (arm === "none") return { arm, exemplars: [], shortfall: null };

  const eligible = eligiblePool({
    pool: input.pool,
    benchmark: input.benchmark,
    seed: input.seed ?? "jami-exemplars",
    sourceFor: input.sourceFor,
  });

  const targetQuestion = groupKey(target);
  const matches = (record: MarkingCorpusRecord) => {
    // Never another answer to the question under test.
    if (groupKey(record) === targetQuestion) return false;
    if (arm === "generic") return true;
    if (arm === "regime") return record.regime === target.regime;
    return (
      record.regime === target.regime &&
      record.subject === target.subject &&
      record.level === target.level
    );
  };

  const exemplars: MarkingCorpusRecord[] =
    arm === "generic"
      ? spreadAcrossKinds(eligible.filter(matches), count)
      : takeFirst(eligible, matches, count);

  const shortfall =
    exemplars.length === 0
      ? `No exemplar in the pool matches ${arm} for ${target.level}/${target.subject}/${target.regime}.`
      : exemplars.length < count
        ? `Only ${exemplars.length} of ${count} exemplars available for ${arm}.`
        : null;

  return { arm, exemplars, shortfall };
}

/**
 * How much of the benchmark each arm can actually be run on.
 *
 * Worth knowing before spending anything: if arm D can only be filled for a
 * tenth of the benchmark, comparing its score against arm A's over different
 * subsets would compare two different exams. The runner uses this to restrict
 * every arm to the responses all of them can serve.
 */
export function armCoverage(input: {
  benchmark: readonly MarkingCorpusRecord[];
  pool: readonly MarkingCorpusRecord[];
  count?: number;
  seed?: string;
  sourceFor?: (sourceId: string) => MarkingCorpusSource | undefined;
}) {
  return EXEMPLAR_ARMS.map((arm) => {
    const servable = input.benchmark.filter(
      (target) => selectExemplars({ ...input, arm, target }).exemplars.length > 0 || arm === "none"
    );
    return {
      arm,
      servable: servable.length,
      share: input.benchmark.length === 0 ? 0 : servable.length / input.benchmark.length,
    };
  });
}

/**
 * Arms that would choose exactly the same exemplars as each other.
 *
 * The failure this catches is quiet and total. If the pool holds only one
 * level/subject/regime combination, then "any exemplar", "same regime" and
 * "same subject, level and regime" all select the same records, and the three
 * arms are one arm wearing three names. Their scores would come out identical
 * and the natural reading — that matching exemplars to the response makes no
 * difference — would be exactly backwards: the experiment never varied the
 * thing it claims to test.
 *
 * Reported before a run rather than discovered after paying for one.
 */
export function detectArmCollapse(input: {
  benchmark: readonly MarkingCorpusRecord[];
  pool: readonly MarkingCorpusRecord[];
  count?: number;
  seed?: string;
  sourceFor?: (sourceId: string) => MarkingCorpusSource | undefined;
}) {
  const targets = commonBenchmark(input);
  const compared = EXEMPLAR_ARMS.filter((arm) => arm !== "none");
  const collapsed: { arms: ExemplarArm[]; records: number }[] = [];

  for (let left = 0; left < compared.length; left += 1) {
    for (let right = left + 1; right < compared.length; right += 1) {
      let identical = 0;
      for (const target of targets) {
        const a = selectExemplars({ ...input, arm: compared[left], target }).exemplars;
        const b = selectExemplars({ ...input, arm: compared[right], target }).exemplars;
        if (a.length === b.length && a.every((record, index) => record.id === b[index].id)) {
          identical += 1;
        }
      }
      if (identical > 0) {
        collapsed.push({ arms: [compared[left], compared[right]], records: identical });
      }
    }
  }
  return { targets: targets.length, collapsed };
}

/**
 * The responses every arm can serve.
 *
 * The comparison is only meaningful over a common set. Letting each arm run on
 * whatever it could fill would mean arm D was scored on the subjects that
 * happen to have exemplars and arm A on everything, and the difference between
 * them would be a difference in the exam, not in the marking.
 */
export function commonBenchmark(input: {
  benchmark: readonly MarkingCorpusRecord[];
  pool: readonly MarkingCorpusRecord[];
  count?: number;
  seed?: string;
  sourceFor?: (sourceId: string) => MarkingCorpusSource | undefined;
}) {
  return input.benchmark.filter((target) =>
    EXEMPLAR_ARMS.every(
      (arm) => arm === "none" || selectExemplars({ ...input, arm, target }).exemplars.length > 0
    )
  );
}
