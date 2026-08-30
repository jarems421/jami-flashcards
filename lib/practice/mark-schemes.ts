/**
 * Mark schemes, in the five shapes real assessment actually uses.
 *
 * A physics calculation, a biology six-marker, a history essay, a language
 * speaking task and a postgraduate dissertation are marked five genuinely
 * different ways, and a single sum-to-total rule would break four of them. The
 * regime is a property of the *question*, chosen when the scheme is written and
 * stored with it — never re-derived at marking time from the subject's name,
 * because a physics paper holds both a calculation and a banded six-marker.
 *
 * The item is a discriminated union rather than a bag of optional arrays, so a
 * banded question cannot carry a points array at all. That is the difference
 * between a shape that is validated and a shape that cannot be wrong.
 *
 * Notation follows the boards rather than anything invented here: M for a
 * method that could lead to a correct answer, A for accuracy following correct
 * method, B for an independent mark, P for a point drawn from a pool, with
 * `dep`, `ft` and `oe` as the standard modifiers. Every model in the pipeline
 * has read enormous quantities of published mark schemes written in exactly
 * this vocabulary, so asking for it is asking for a pattern already known.
 */

export type PracticePaperMarkingModel =
  | "additive"
  | "pointPool"
  | "banded"
  | "weightedTraits"
  | "competency";

export type PracticePaperMarkCode = "M" | "A" | "B" | "P";

export const PRACTICE_PAPER_MARKING_MODELS: readonly PracticePaperMarkingModel[] = [
  "additive",
  "pointPool",
  "banded",
  "weightedTraits",
  "competency",
];

/**
 * A quantitative answer the checker can verify without a model.
 *
 * This is the only place in the whole pipeline where a mark can be tested
 * against reality rather than against another model's opinion, so it is worth
 * carrying even though most questions will not have one.
 */
export type PracticePaperExpectedValue = {
  value: number;
  /** Absolute tolerance; 0 means exact. */
  tolerance: number;
  unit?: string;
  significantFigures?: number;
};

export type PracticePaperMarkPoint = {
  id: string;
  marks: number;
  code: PracticePaperMarkCode;
  text: string;
  /** Ids in the same question this point depends on. */
  dep: string[];
  /** Follow through: creditable on a wrong but consistently carried value. */
  ft: boolean;
  /** Wording that must be present; underlined in real schemes. */
  essentialTerms: string[];
  /** Accepted equivalents — the "or" and "/" of a printed scheme. */
  allow: string[];
  /** Explicitly not creditworthy. */
  reject: string[];
  /**
   * The assessment objective this mark is for, where the subject uses them.
   *
   * Separate from `code`, which is M/A/B -- method, accuracy, independent --
   * and says how a mark behaves, not what it assesses. A psychology paper
   * reporting its points as A and B says nothing about whether it is weighted
   * correctly between knowledge, application and evaluation, and a paper whose
   * AO balance cannot be computed cannot be checked against a specification.
   */
  assessmentObjective?: string;
  expected?: PracticePaperExpectedValue;
};

export type PracticePaperMarkBand = {
  id: string;
  label: string;
  minMarks: number;
  maxMarks: number;
  descriptor: string;
  /** The assessment objectives this band credits, where the subject uses them. */
  assessmentObjectives?: string[];
};

export type PracticePaperMarkTrait = {
  id: string;
  label: string;
  /**
   * Marks, not a percentage. Percent-versus-mark ambiguity is exactly how a
   * scheme ends up looking right and not adding up.
   */
  maxMarks: number;
  bands: PracticePaperMarkBand[];
  learningOutcome?: string;
};

export type PracticePaperCompetency = {
  id: string;
  text: string;
  level: "pass" | "merit" | "distinction";
};

type MarkSchemeItemCommon = {
  questionId: string;
  maxMarks: number;
  answer: string;
  acceptableAlternatives: string[];
  commonMistakes: string[];
};

export type PracticePaperMarkSchemeItem = MarkSchemeItemCommon &
  (
    | { marking: "additive"; points: PracticePaperMarkPoint[] }
    | { marking: "pointPool"; points: PracticePaperMarkPoint[]; awardable: number }
    | { marking: "banded"; bands: PracticePaperMarkBand[] }
    | { marking: "weightedTraits"; traits: PracticePaperMarkTrait[] }
    | { marking: "competency"; competencies: PracticePaperCompetency[] }
  );

export type MarkSchemeQuestion = { id: string; marks: number };

export type MarkSchemeIssue = {
  questionId: string;
  code: string;
  detail: string;
};

const MAX_POINTS = 40;
const MAX_BANDS = 12;
const MAX_TRAITS = 10;
const MAX_COMPETENCIES = 20;

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function textList(value: unknown, maximum: number, maxLength = 400) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maximum)
    .map((item) => text(item, maxLength))
    .filter(Boolean);
}

function integer(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function markCode(value: unknown, fallback: PracticePaperMarkCode) {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  return upper === "M" || upper === "A" || upper === "B" || upper === "P"
    ? (upper as PracticePaperMarkCode)
    : fallback;
}

function expectedValue(value: unknown): PracticePaperExpectedValue | undefined {
  if (!isRecord(value)) return undefined;
  const raw = typeof value.value === "number" ? value.value : Number(value.value);
  if (!Number.isFinite(raw)) return undefined;
  const tolerance =
    typeof value.tolerance === "number" ? Math.abs(value.tolerance) : Number(value.tolerance);
  const significantFigures = integer(value.significantFigures, 0);
  return {
    value: raw,
    tolerance: Number.isFinite(tolerance) ? Math.abs(tolerance) : 0,
    ...(text(value.unit, 40) ? { unit: text(value.unit, 40) } : {}),
    ...(significantFigures > 0 ? { significantFigures } : {}),
  };
}

/**
 * The assessment objectives a mark or band carries.
 *
 * Read from an explicit field where the model supplies one, and otherwise from
 * the prose, which already says it: schemes come back written "AO1 (knowledge
 * of the multi-store model): ..." and "AO2 only. The behaviour indicates ...".
 * That text was there all along with nothing reading it, so a paper's AO
 * balance could not be computed and could not be checked against a
 * specification that states one.
 */
export function readAssessmentObjectives(...sources: unknown[]) {
  const found = new Set<string>();
  for (const source of sources) {
    for (const value of Array.isArray(source) ? source : [source]) {
      if (typeof value !== "string") continue;
      for (const match of value.matchAll(/\bAO\s?([123])\b/gi)) found.add(`AO${match[1]}`);
    }
  }
  return [...found].sort();
}

function normalizePoints(value: unknown, questionId: string, poolPoint: boolean) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const points: PracticePaperMarkPoint[] = [];
  value.slice(0, MAX_POINTS).forEach((candidate, index) => {
    if (!isRecord(candidate)) return;
    const body = text(candidate.text, 800);
    if (!body) return;
    const id = text(candidate.id, 80) || `${questionId}.${poolPoint ? "p" : "m"}${index + 1}`;
    if (seen.has(id)) return;
    seen.add(id);
    points.push({
      id,
      marks: Math.max(1, integer(candidate.marks, 1)),
      code: markCode(candidate.code, poolPoint ? "P" : "M"),
      text: body,
      dep: textList(candidate.dep, 8, 80),
      ft: candidate.ft === true,
      essentialTerms: textList(candidate.essentialTerms, 8, 120),
      allow: textList(candidate.allow, 12, 200),
      reject: textList(candidate.reject, 12, 200),
      ...(readAssessmentObjectives(candidate.assessmentObjective, candidate.ao, body)[0]
        ? { assessmentObjective: readAssessmentObjectives(candidate.assessmentObjective, candidate.ao, body)[0] }
        : {}),
      ...(expectedValue(candidate.expected)
        ? { expected: expectedValue(candidate.expected)! }
        : {}),
    });
  });
  return points;
}

function normalizeBands(value: unknown, questionId: string, prefix = "L") {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const bands: PracticePaperMarkBand[] = [];
  value.slice(0, MAX_BANDS).forEach((candidate, index) => {
    if (!isRecord(candidate)) return;
    const descriptor = text(candidate.descriptor, 1_200);
    if (!descriptor) return;
    const id = text(candidate.id, 80) || `${questionId}.${prefix}${index + 1}`;
    if (seen.has(id)) return;
    seen.add(id);
    const minMarks = Math.max(0, integer(candidate.minMarks, 0));
    bands.push({
      id,
      label: text(candidate.label, 80) || `Level ${index + 1}`,
      ...(readAssessmentObjectives(candidate.assessmentObjectives, candidate.ao, descriptor).length
        ? { assessmentObjectives: readAssessmentObjectives(candidate.assessmentObjectives, candidate.ao, descriptor) }
        : {}),
      minMarks,
      maxMarks: Math.max(minMarks, integer(candidate.maxMarks, minMarks)),
      descriptor,
    });
  });
  return bands.sort((left, right) => left.minMarks - right.minMarks);
}

function normalizeTraits(value: unknown, questionId: string) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const traits: PracticePaperMarkTrait[] = [];
  value.slice(0, MAX_TRAITS).forEach((candidate, index) => {
    if (!isRecord(candidate)) return;
    const id = text(candidate.id, 80) || `${questionId}.t${index + 1}`;
    /**
     * A trait with no label is still a trait.
     *
     * Dropping it threw away a correct mark scheme over a missing display
     * string. A twelve-mark essay came back with two traits of six marks each,
     * four bands apiece and no labels; both were discarded here, and validation
     * then reported single_trait, traits_do_not_sum and no_credit_units on a
     * scheme that had none of those faults. The repair produced the same
     * correct traits twice more, was discarded twice more, and the paper failed.
     *
     * What a trait needs to be usable is its marks and its bands. A name is how
     * it is shown to a student, so an unnamed one is named after its position
     * rather than deleted.
     */
    const label = text(candidate.label, 120) || `Trait ${index + 1}`;
    if (seen.has(id)) return;
    seen.add(id);
    const learningOutcome = text(candidate.learningOutcome, 400);
    traits.push({
      id,
      label,
      maxMarks: Math.max(1, integer(candidate.maxMarks, 1)),
      bands: normalizeBands(candidate.bands, id, "b"),
      ...(learningOutcome ? { learningOutcome } : {}),
    });
  });
  return traits;
}

function normalizeCompetencies(value: unknown, questionId: string) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const competencies: PracticePaperCompetency[] = [];
  value.slice(0, MAX_COMPETENCIES).forEach((candidate, index) => {
    if (!isRecord(candidate)) return;
    const body = text(candidate.text, 800);
    if (!body) return;
    const id = text(candidate.id, 80) || `${questionId}.c${index + 1}`;
    if (seen.has(id)) return;
    seen.add(id);
    const level = candidate.level;
    competencies.push({
      id,
      text: body,
      level: level === "merit" || level === "distinction" ? level : "pass",
    });
  });
  return competencies;
}

function markingModel(value: unknown): PracticePaperMarkingModel | null {
  return typeof value === "string" &&
    (PRACTICE_PAPER_MARKING_MODELS as readonly string[]).includes(value)
    ? (value as PracticePaperMarkingModel)
    : null;
}

/**
 * Parse one scheme item, or return null.
 *
 * Null rather than a coerced shell: a scheme item that cannot be read is a
 * generation failure, and the count check downstream turns it into a repair
 * pass. Guessing a shape here would launder bad output into a stored paper.
 */
export function normalizeMarkSchemeItem(
  value: unknown,
  question: MarkSchemeQuestion
): PracticePaperMarkSchemeItem | null {
  if (!isRecord(value)) return null;
  const model = markingModel(value.marking);
  if (!model) return null;

  const common: MarkSchemeItemCommon = {
    questionId: question.id,
    maxMarks: question.marks,
    answer: text(value.answer, 4_000),
    acceptableAlternatives: textList(value.acceptableAlternatives, 20),
    commonMistakes: textList(value.commonMistakes, 20),
  };

  switch (model) {
    case "additive":
      return { ...common, marking: "additive", points: normalizePoints(value.points, question.id, false) };
    case "pointPool":
      return {
        ...common,
        marking: "pointPool",
        points: normalizePoints(value.points, question.id, true),
        awardable: Math.max(0, integer(value.awardable, 0)),
      };
    case "banded":
      return { ...common, marking: "banded", bands: normalizeBands(value.bands, question.id) };
    case "weightedTraits":
      return { ...common, marking: "weightedTraits", traits: normalizeTraits(value.traits, question.id) };
    case "competency":
      return {
        ...common,
        marking: "competency",
        competencies: normalizeCompetencies(value.competencies, question.id),
      };
  }
}

function dependencyCycle(points: readonly PracticePaperMarkPoint[]) {
  const byId = new Map(points.map((point) => [point.id, point]));
  const state = new Map<string, "visiting" | "done">();
  const walk = (id: string): boolean => {
    const status = state.get(id);
    if (status === "visiting") return true;
    if (status === "done") return false;
    state.set(id, "visiting");
    for (const next of byId.get(id)?.dep ?? []) {
      if (byId.has(next) && walk(next)) return true;
    }
    state.set(id, "done");
    return false;
  };
  return points.some((point) => walk(point.id));
}

function bandsCover(bands: readonly PracticePaperMarkBand[], maxMarks: number) {
  if (bands.length < 2) return false;
  const sorted = [...bands].sort((left, right) => left.minMarks - right.minMarks);
  if (sorted[0].minMarks !== 0) return false;
  if (sorted[sorted.length - 1].maxMarks !== maxMarks) return false;
  for (let index = 0; index < sorted.length; index += 1) {
    const band = sorted[index];
    if (band.maxMarks < band.minMarks) return false;
    const next = sorted[index + 1];
    if (next && next.minMarks !== band.maxMarks + 1) return false;
  }
  return true;
}

/**
 * Everything that must hold before a scheme is worth storing.
 *
 * These are the checks no amount of shared model bias can defeat. Two markers
 * can agree on a wrong mark; they cannot agree that 1 + 1 + 1 is 5, that a mark
 * of 11 sits in a band running 7 to 9, that seven points were drawn from a pool
 * of six, or that traits worth 8, 6 and 4 make up a 20-mark question.
 */
export function validateMarkSchemeItem(
  item: PracticePaperMarkSchemeItem
): MarkSchemeIssue[] {
  const issues: MarkSchemeIssue[] = [];
  const fail = (code: string, detail: string) =>
    issues.push({ questionId: item.questionId, code, detail });

  if (item.maxMarks < 1) fail("no_marks", "A question must be worth at least one mark.");

  switch (item.marking) {
    case "additive": {
      const total = item.points.reduce((sum, point) => sum + point.marks, 0);
      if (item.points.length === 0) fail("no_points", "An additive question needs at least one mark point.");
      if (total !== item.maxMarks) {
        fail("marks_do_not_sum", `Points total ${total} against a ${item.maxMarks}-mark question.`);
      }
      const ids = new Set(item.points.map((point) => point.id));
      for (const point of item.points) {
        for (const dependency of point.dep) {
          if (!ids.has(dependency)) {
            fail("dangling_dependency", `${point.id} depends on ${dependency}, which is not in this question.`);
          }
        }
        if (point.code === "M") {
          const dependsOnAccuracy = point.dep.some(
            (dependency) => item.points.find((other) => other.id === dependency)?.code === "A"
          );
          // A method mark cannot rest on the accuracy that follows from it.
          if (dependsOnAccuracy) {
            fail("inverted_dependency", `${point.id} is a method mark depending on an accuracy mark.`);
          }
        }
      }
      if (dependencyCycle(item.points)) {
        fail("dependency_cycle", "Mark point dependencies form a cycle.");
      }
      break;
    }
    case "pointPool": {
      if (item.awardable < 1) fail("no_awardable", "A pool must award at least one point.");
      if (item.points.length <= item.awardable) {
        fail(
          "not_a_pool",
          `A pool of ${item.points.length} offering ${item.awardable} is not a pool; use additive marking.`
        );
      }
      const values = new Set(item.points.map((point) => point.marks));
      if (values.size > 1) {
        fail("uneven_pool", "Every point in a pool must be worth the same.");
      }
      const perPoint = item.points[0]?.marks ?? 0;
      if (item.awardable * perPoint !== item.maxMarks) {
        fail(
          "pool_does_not_sum",
          `${item.awardable} points at ${perPoint} each against a ${item.maxMarks}-mark question.`
        );
      }
      break;
    }
    case "banded": {
      if (!bandsCover(item.bands, item.maxMarks)) {
        fail(
          "bands_do_not_cover",
          `Bands must be contiguous and cover 0 to ${item.maxMarks} exactly.`
        );
      }
      break;
    }
    case "weightedTraits": {
      if (item.traits.length < 2) {
        fail("single_trait", "One trait is a banded question, not a weighted set.");
      }
      const total = item.traits.reduce((sum, trait) => sum + trait.maxMarks, 0);
      if (total !== item.maxMarks) {
        fail("traits_do_not_sum", `Traits total ${total} against a ${item.maxMarks}-mark question.`);
      }
      for (const trait of item.traits) {
        if (!bandsCover(trait.bands, trait.maxMarks)) {
          fail(
            "trait_bands_do_not_cover",
            `${trait.label} needs contiguous bands covering 0 to ${trait.maxMarks}.`
          );
        }
      }
      break;
    }
    case "competency": {
      if (item.competencies.length === 0) {
        fail("no_competencies", "A competency assessment needs at least one criterion.");
      }
      break;
    }
  }

  // Across every regime: a question worth real marks must say how they are
  // earned. This closes the hole where a scheme passed on a model answer alone.
  if (item.maxMarks >= 2 && creditUnitCount(item) === 0) {
    fail("no_credit_units", "A question worth two or more marks must state how they are earned.");
  }

  return issues;
}

export function creditUnitCount(item: PracticePaperMarkSchemeItem) {
  switch (item.marking) {
    case "additive":
    case "pointPool":
      return item.points.length;
    case "banded":
      return item.bands.length;
    case "weightedTraits":
      return item.traits.length;
    case "competency":
      return item.competencies.length;
  }
}

/**
 * Stable identifiers for the things a marker can award, taken from the scheme
 * before any model sees it.
 *
 * Two blind markers used to be compared on the prose they wrote for each
 * criterion, which meant "Identifies the writer's use of metaphor" and
 * "Identifies use of metaphor" counted as different criteria and forced an
 * adjudication. Free text cannot be an identifier: it is generated
 * independently by two different models and will essentially never match.
 *
 * The scheme already knows what is creditable, so the identity comes from
 * there. Both markers are handed the same list and asked to answer against it,
 * which makes their reports comparable by construction rather than by luck.
 *
 * Banded questions return nothing here on purpose. A band is a judgement about
 * the whole response, not a list of separately awardable criteria, so there is
 * nothing to line up and no comparison to make.
 */
/**
 * One creditable criterion as both markers are handed it.
 *
 * Declared rather than inferred, because inference narrows to whichever branch
 * comes first and hides the fields the others carry.
 */
export type SchemeCriterion = {
  id: string;
  text: string;
  marks: number;
  learningOutcome?: string;
  /** The levels a trait's mark is placed against, where the scheme states them. */
  levels?: { label: string; marks: string; descriptor: string }[];
};

export function schemeCriteria(item: PracticePaperMarkSchemeItem): SchemeCriterion[] {
  const label = (index: number) => `C${index + 1}`;
  switch (item.marking) {
    case "additive":
    case "pointPool":
      return item.points.map((point, index) => ({
        id: label(index),
        text: point.text,
        marks: point.marks,
      }));
    case "weightedTraits":
      /**
       * With the descriptors, because a trait without them is a scale with no
       * marks on it.
       *
       * This list is what both blind markers are handed, and it used to carry
       * "Analysing and synthesising, 10 marks" and nothing else. Asked to place
       * a mark on that, a marker does the only sensible thing and hedges to the
       * middle: measured over five coursework assignments, examiners used the
       * whole 0 to 10 range on that trait and Jami never left 4 to 7, which
       * alone accounted for 4.2 of a 5.0 mark error on a 30-mark paper.
       *
       * The bands were reachable -- the whole scheme is serialised into the
       * prompt beside this -- but only by cross-referencing two shapes for the
       * same thing. Naming the levels where the trait is named is what makes
       * the difference between judging against a rubric and guessing.
       */
      return item.traits.map((trait, index) => ({
        id: label(index),
        text: trait.label,
        marks: trait.maxMarks,
        ...(trait.learningOutcome ? { learningOutcome: trait.learningOutcome } : {}),
        ...(trait.bands.length > 0
          ? {
              levels: trait.bands.map((band) => ({
                label: band.label,
                marks: band.minMarks === band.maxMarks
                  ? `${band.maxMarks}`
                  : `${band.minMarks}-${band.maxMarks}`,
                descriptor: band.descriptor,
              })),
            }
          : {}),
      }));
    case "competency":
      return item.competencies.map((competency, index) => ({
        id: label(index),
        text: competency.text,
        marks: 0,
      }));
    case "banded":
      /**
       * A banded question is a single judgement placed in a level, not a sum of
       * criteria, so there is nothing to itemise. The levels still reach the
       * marker through the serialised scheme.
       */
      return [];
  }
}

/** Whether a numeric answer earns its point, decided without a model. */
export function meetsExpectedValue(
  expected: PracticePaperExpectedValue,
  candidate: number
) {
  if (!Number.isFinite(candidate)) return false;
  return Math.abs(candidate - expected.value) <= expected.tolerance;
}

/**
 * How a paper's marks divide between assessment objectives.
 *
 * A specification states its AO weightings, and until the schemes said which
 * objective each mark was for there was nothing to compare them against: the
 * paper reported its marks as A and B, which describe how a mark behaves, not
 * what it assesses.
 *
 * Marks whose objective is unstated are counted as `unattributed` rather than
 * spread across the others. A balance computed by guessing where the missing
 * marks belong would look like a measurement and be an assumption.
 */
export function paperAssessmentObjectiveMarks(
  items: readonly PracticePaperMarkSchemeItem[]
) {
  const totals = new Map<string, number>();
  const add = (objective: string, marks: number) =>
    totals.set(objective, (totals.get(objective) ?? 0) + marks);

  for (const item of items) {
    const record = item as unknown as Record<string, unknown>;
    const points = (record.points as PracticePaperMarkPoint[]) ?? [];
    if (points.length > 0) {
      for (const point of points) {
        add(point.assessmentObjective ?? "unattributed", point.marks);
      }
      continue;
    }
    // A banded question credits its objectives across the whole tariff rather
    // than mark by mark, so its marks divide evenly between the objectives its
    // bands name.
    const bands = (record.bands as PracticePaperMarkBand[]) ?? [];
    const objectives = [...new Set(bands.flatMap((band) => band.assessmentObjectives ?? []))];
    if (objectives.length === 0) {
      add("unattributed", item.maxMarks);
      continue;
    }
    const each = item.maxMarks / objectives.length;
    for (const objective of objectives) add(objective, each);
  }
  return Object.fromEntries([...totals.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
