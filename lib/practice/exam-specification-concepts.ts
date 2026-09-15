import { EXAM_SPECIFICATION_OUTLINES, outlineConcepts } from "@/lib/practice/exam-specification-outlines";
import { servableExamSpecificationTopics } from "@/lib/practice/exam-specification-topics";

/**
 * Finer concepts beneath a specification's topics.
 *
 * Kept apart from the topic catalogue on purpose. Extraction, topic tagging,
 * the student's topic picker and corpus calibration all read a catalogue's
 * `topics` directly, so a draft subtopic added there would reach every one of
 * them. Here a concept is invisible to all of them, and to the Learning Engine,
 * until its catalogue is verified.
 *
 * Ids follow the topic rule: stable, descriptive, never the board's reference
 * number (which is kept as metadata, because boards renumber). A concept always
 * names its parent topic, so evidence on it rolls up to a topic the rest of
 * the app already understands.
 */

export type ExamSpecificationConcept = {
  id: string;
  parentTopicId: string;
  label: string;
  /** The board's own reference, such as "A13". Metadata only. */
  reference?: string;
  /** Common student shorthand for the same concept. */
  aliases?: readonly string[];
  /** Assessed on the higher tier only, where the specification says so. */
  higherTierOnly?: boolean;
};

export type ExamSpecificationConceptCatalogue = {
  specificationId: string;
  version: number;
  /** Checked against the published specification by a person. Nothing unverified is served. */
  verified: boolean;
  /** `ai_suggested` until a person checks it; `verified_specification` once they have. */
  provenance: "ai_suggested" | "verified_specification";
  source: string;
  concepts: readonly ExamSpecificationConcept[];
};

function concepts(
  prefix: string,
  parentTopicId: string,
  rows: readonly (readonly [reference: string, slug: string, label: string, aliases?: readonly string[]])[]
): ExamSpecificationConcept[] {
  return rows.map(([reference, slug, label, aliases]) => ({
    id: `${prefix}-${slug}`,
    parentTopicId,
    label,
    reference,
    ...(aliases ? { aliases } : {}),
  }));
}

/** Catalogues written out concept by concept. */
const WRITTEN_CATALOGUES: readonly ExamSpecificationConceptCatalogue[] = [
  {
    /*
     * AQA GCSE Mathematics (8300) subject content statements, one concept per
     * statement.
     *
     * Drafted by an AI assistant from memory of the published subject content,
     * then checked against the specification by the Jami owner on 2026-09-15:
     * the reference numbers, which subsection each statement sits under, and
     * every label. The labels are deliberately short paraphrases rather than
     * the board's wording.
     */
    specificationId: "8300",
    version: 1,
    verified: true,
    provenance: "verified_specification",
    source:
      "Drafted from memory of the AQA GCSE Mathematics (8300) subject content statements " +
      "(N1-N16, A1-A25, R1-R16, G1-G25, P1-P9, S1-S6), then checked against the " +
      "specification by the Jami owner on 2026-09-15.",
    concepts: [
      ...concepts("aqa-8300-number", "aqa-8300-number-structure-and-calculation", [
        ["N1", "ordering", "Ordering integers, decimals and fractions"],
        ["N2", "four-operations", "The four operations with integers, decimals and fractions"],
        ["N3", "order-of-operations", "Inverse operations and the order of operations", ["BIDMAS", "BODMAS"]],
        ["N4", "primes-factors-multiples", "Primes, factors, multiples, HCF and LCM", ["HCF", "LCM", "Prime factorisation"]],
        ["N5", "counting-strategies", "Systematic listing and the product rule for counting"],
        ["N6", "powers-and-roots", "Powers, roots and the laws of indices", ["Indices"]],
        ["N7", "calculating-with-indices", "Calculating with roots and integer or fractional indices"],
        ["N8", "exact-calculation-and-surds", "Exact calculation with fractions, pi and surds", ["Surds"]],
        ["N9", "standard-form", "Standard form"],
      ]),
      ...concepts("aqa-8300-number", "aqa-8300-number-fractions-decimals-and-percentages", [
        ["N10", "fraction-decimal-conversion", "Converting between fractions and decimals, including recurring decimals"],
        ["N11", "fractions-in-ratio", "Fractions in ratio problems"],
        ["N12", "fractions-and-percentages-as-operators", "Fractions and percentages as operators"],
      ]),
      ...concepts("aqa-8300-number", "aqa-8300-number-measures-and-accuracy", [
        ["N13", "units-of-measure", "Standard and compound units of measure"],
        ["N14", "estimation", "Estimating and checking calculations"],
        ["N15", "rounding", "Rounding to decimal places and significant figures", ["Significant figures"]],
        ["N16", "bounds", "Limits of accuracy, error intervals and bounds", ["Upper and lower bounds"]],
      ]),
      ...concepts("aqa-8300-algebra", "aqa-8300-algebra-notation-vocabulary-and-manipulation", [
        ["A1", "notation", "Algebraic notation"],
        ["A2", "substitution", "Substituting into formulae and expressions"],
        ["A3", "vocabulary", "Expressions, equations, formulae, identities and terms"],
        ["A4", "manipulation", "Simplifying, expanding and factorising expressions", ["Factorising", "Expanding brackets"]],
        ["A5", "rearranging-formulae", "Using and rearranging formulae", ["Changing the subject"]],
        ["A6", "identities-and-proof", "Identities and algebraic proof"],
        ["A7", "functions", "Functions, including composite and inverse functions"],
      ]),
      ...concepts("aqa-8300-algebra", "aqa-8300-algebra-graphs", [
        ["A8", "coordinates", "Coordinates in all four quadrants"],
        ["A9", "straight-line-graphs", "Straight-line graphs and y = mx + c"],
        ["A10", "gradients-and-intercepts", "Gradients and intercepts of linear functions"],
        ["A11", "quadratic-graphs", "Roots, intercepts and turning points of quadratics"],
        ["A12", "recognising-graphs", "Recognising and sketching standard graphs"],
        ["A13", "graph-transformations", "Translations and reflections of graphs", ["Graph transformations"]],
        ["A14", "real-life-graphs", "Plotting and interpreting graphs in real contexts"],
        ["A15", "gradients-and-areas-under-graphs", "Gradients of and areas under graphs"],
        ["A16", "circle-equations", "Equation of a circle and its tangents"],
      ]),
      ...concepts("aqa-8300-algebra", "aqa-8300-algebra-solving-equations-and-inequalities", [
        ["A17", "linear-equations", "Solving linear equations"],
        ["A18", "quadratic-equations", "Solving quadratic equations", ["Quadratic formula", "Completing the square"]],
        ["A19", "simultaneous-equations", "Simultaneous equations"],
        ["A20", "iteration", "Approximate solutions by iteration"],
        ["A21", "forming-equations", "Forming and solving equations from a context"],
        ["A22", "inequalities", "Linear and quadratic inequalities"],
      ]),
      ...concepts("aqa-8300-algebra", "aqa-8300-algebra-sequences", [
        ["A23", "sequence-rules", "Term-to-term and position-to-term rules"],
        ["A24", "special-sequences", "Special sequences, arithmetic and geometric progressions"],
        ["A25", "nth-term", "The nth term of linear and quadratic sequences"],
      ]),
      ...concepts("aqa-8300-ratio", "aqa-8300-ratio-proportion-and-rates-of-change", [
        ["R1", "unit-conversions", "Converting between standard and compound units"],
        ["R2", "scale-diagrams", "Scale factors, scale diagrams and maps"],
        ["R3", "quantity-as-fraction", "One quantity as a fraction of another"],
        ["R4", "ratio-notation", "Ratio notation and simplest form"],
        ["R5", "sharing-in-a-ratio", "Dividing a quantity in a given ratio"],
        ["R6", "multiplicative-relationships", "Multiplicative relationships as ratios or fractions"],
        ["R7", "proportion", "Proportion as equality of ratios"],
        ["R8", "ratios-fractions-and-linear-functions", "Relating ratios to fractions and linear functions"],
        ["R9", "percentages", "Percentages, percentage change and reverse percentages", ["Percentage change", "Reverse percentages"]],
        ["R10", "direct-and-inverse-proportion", "Direct and inverse proportion problems"],
        ["R11", "compound-units", "Compound units such as speed, density and pressure"],
        ["R12", "similarity-ratios", "Comparing lengths, areas and volumes using ratio"],
        ["R13", "proportion-equations", "Equations for direct and inverse proportion"],
        ["R14", "gradient-as-rate-of-change", "Gradient as a rate of change"],
        ["R15", "instantaneous-rate-of-change", "Instantaneous and average rates of change"],
        ["R16", "growth-and-decay", "Growth, decay and compound interest", ["Compound interest"]],
      ]),
      ...concepts("aqa-8300-geometry", "aqa-8300-geometry-properties-and-constructions", [
        ["G1", "terms-and-symmetry", "Geometric terms, notation and symmetry"],
        ["G2", "constructions-and-loci", "Constructions and loci"],
        ["G3", "angle-facts", "Angle facts, including parallel lines and polygons"],
        ["G4", "triangles-and-quadrilaterals", "Properties of triangles and quadrilaterals"],
        ["G5", "congruence", "Congruence criteria"],
        ["G6", "geometric-proof", "Deriving and proving geometric results"],
        ["G7", "transformations", "Rotations, reflections, translations and enlargements"],
        ["G8", "combined-transformations", "Combining transformations"],
        ["G9", "circle-parts", "Parts of a circle"],
        ["G10", "circle-theorems", "Circle theorems"],
        ["G11", "coordinate-geometry", "Geometric problems on coordinate axes"],
        ["G12", "three-dimensional-shapes", "Properties of 3D shapes"],
        ["G13", "plans-and-elevations", "Plans and elevations"],
        ["G14", "measures-in-geometry", "Units of measure in geometry"],
        ["G15", "measuring-and-bearings", "Measuring lengths, angles and bearings", ["Bearings"]],
      ]),
      ...concepts("aqa-8300-geometry", "aqa-8300-geometry-mensuration-and-calculation", [
        ["G16", "area-and-volume", "Areas of 2D shapes and volumes of prisms"],
        ["G17", "circles-and-solids", "Circles, spheres, cones and pyramids"],
        ["G18", "arcs-and-sectors", "Arc lengths and sector areas"],
        ["G19", "similarity", "Similarity in lengths, areas and volumes"],
        ["G20", "pythagoras-and-trigonometry", "Pythagoras' theorem and right-angled trigonometry", ["Pythagoras", "SOHCAHTOA"]],
        ["G21", "exact-trigonometric-values", "Exact trigonometric values"],
        ["G22", "sine-and-cosine-rules", "Sine rule, cosine rule and the area of a triangle"],
        ["G23", "three-dimensional-trigonometry", "Pythagoras and trigonometry in 3D"],
      ]),
      ...concepts("aqa-8300-geometry", "aqa-8300-geometry-vectors", [
        ["G24", "column-vectors", "Translations as column vectors"],
        ["G25", "vector-arithmetic-and-proof", "Vector arithmetic and vector proof"],
      ]),
      ...concepts("aqa-8300-probability", "aqa-8300-probability", [
        ["P1", "frequency-trees", "Recording outcomes in tables and frequency trees"],
        ["P2", "randomness-and-fairness", "Randomness, fairness and equally likely outcomes"],
        ["P3", "expected-frequency", "Relative and expected frequency"],
        ["P4", "exhaustive-and-exclusive-events", "Probabilities that sum to one and mutually exclusive events"],
        ["P5", "sample-size", "Experimental probability and sample size"],
        ["P6", "venn-and-tree-diagrams", "Sets, Venn diagrams and tree diagrams", ["Venn diagrams"]],
        ["P7", "sample-spaces", "Sample spaces for combined experiments"],
        ["P8", "combined-events", "Independent and dependent combined events"],
        ["P9", "conditional-probability", "Conditional probability"],
      ]),
      ...concepts("aqa-8300-statistics", "aqa-8300-statistics", [
        ["S1", "sampling", "Sampling and populations"],
        ["S2", "tables-and-charts", "Tables, charts and diagrams"],
        ["S3", "histograms-and-cumulative-frequency", "Histograms and cumulative frequency"],
        ["S4", "averages-and-spread", "Averages, spread and comparing distributions"],
        ["S5", "describing-populations", "Applying statistics to describe a population"],
        ["S6", "scatter-graphs", "Scatter graphs and correlation"],
      ]),
    ],
  },
];

const aqaMathematics = WRITTEN_CATALOGUES.find((catalogue) => catalogue.specificationId === "8300")!;

/** Every concept catalogue, checked and unchecked. Only a checked one is served. */
export const EXAM_SPECIFICATION_CONCEPTS: readonly ExamSpecificationConceptCatalogue[] = [
  ...WRITTEN_CATALOGUES,
  {
    /*
     * Pearson Edexcel GCSE Mathematics (1MA1): the same subject content
     * statements as AQA 8300, printed under the same codes and subheadings, so
     * the checked 8300 concepts under Pearson's own ids, compared with the
     * Pearson document by the owner before being served.
     */
    specificationId: "1MA1",
    version: 1,
    verified: true,
    provenance: "verified_specification",
    source:
      "The checked AQA 8300 concepts under Pearson ids: the Pearson Edexcel GCSE (9-1) " +
      "Mathematics (1MA1) specification prints the same statements (N1-N16, A1-A25, R1-R16, " +
      "G1-G25, P1-P9, S1-S6) under the same subheadings, read on 2026-09-15. Checked against " +
      "the Pearson specification by the Jami owner on 2026-09-16.",
    concepts: aqaMathematics.concepts.map((concept) => ({
      ...concept,
      id: concept.id.replace("aqa-8300-", "pearson-edexcel-1ma1-"),
      parentTopicId: concept.parentTopicId.replace("aqa-8300-", "pearson-edexcel-1ma1-"),
    })),
  },
  ...EXAM_SPECIFICATION_OUTLINES.map((outline): ExamSpecificationConceptCatalogue => ({
    specificationId: outline.specificationId,
    version: 1,
    verified: outline.checked?.concepts === true,
    provenance: outline.checked?.concepts === true ? "verified_specification" : "ai_suggested",
    source: outline.source,
    concepts: outlineConcepts(outline),
  })),
];

export function examSpecificationConceptCatalogue(specificationId: string) {
  return EXAM_SPECIFICATION_CONCEPTS.find((catalogue) => catalogue.specificationId === specificationId);
}

/**
 * The concepts that may be served and reasoned over: only from a verified
 * concept catalogue, and only beneath a topic its verified topic catalogue
 * still names.
 */
export function servableExamSpecificationConcepts(specificationId: string): ExamSpecificationConcept[] {
  const catalogue = examSpecificationConceptCatalogue(specificationId);
  const topics = servableExamSpecificationTopics(specificationId);
  if (!catalogue?.verified || catalogue.provenance !== "verified_specification" || !topics) return [];
  const topicIds = new Set(topics.topics.map((topic) => topic.id));
  return catalogue.concepts.filter((concept) => topicIds.has(concept.parentTopicId));
}

/**
 * The concepts a question may claim, separated from the ones it invented.
 *
 * The topic rule, one level down: only a checked catalogue's own ids are kept.
 * An id it does not hold is not a near miss to correct but a concept that does
 * not exist on this course, so it is dropped and reported.
 */
export function filterCanonicalConceptIds(
  specificationId: string,
  ids: readonly string[]
): { conceptIds: string[]; rejected: string[] } {
  const known = new Set(servableExamSpecificationConcepts(specificationId).map((concept) => concept.id));
  const conceptIds: string[] = [];
  const rejected: string[] = [];
  for (const id of new Set(ids)) {
    if (known.has(id)) conceptIds.push(id);
    else rejected.push(id);
  }
  return { conceptIds, rejected };
}

/**
 * The topics these concepts sit under.
 *
 * A question about quadratic equations is also about solving equations, so a
 * student narrowing practice by topic still finds it.
 */
export function conceptParentTopicIds(specificationId: string, conceptIds: readonly string[]) {
  const parents = new Map(
    servableExamSpecificationConcepts(specificationId).map((concept) => [concept.id, concept.parentTopicId])
  );
  return Array.from(
    new Set(
      conceptIds.flatMap((id) => {
        const parent = parents.get(id);
        return parent ? [parent] : [];
      })
    )
  );
}
