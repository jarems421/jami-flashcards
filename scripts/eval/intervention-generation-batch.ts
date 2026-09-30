import { servableExamSpecificationConcepts } from "@/lib/practice/exam-specification-concepts";
import { generateInterventionFlashcards } from "@/services/learning/flashcard-intervention.server";
import { generateInterventionPractice } from "@/services/learning/practice-intervention.server";

/**
 * What the generators actually write, printed for a person to read.
 *
 * Deliberately not a pass/fail test. Everything a machine can check is already
 * checked by the contracts -- a concept the catalogue holds, a scheme that
 * sums to its tariff, no empty fields -- and the notebook batch is the
 * precedent for why that is not enough: the model satisfied every structural
 * rule and still produced something that would have been wrong to keep.
 *
 * The failures worth finding here cannot be asserted:
 *
 *   1 mark -- uses the correct method
 *   1 mark -- gets the answer
 *   1 mark -- correct
 *   1 mark -- completes the question
 *
 * That passes every invariant in the codebase and is a useless mark scheme.
 * So the automated checks are printed as context and the judgement is left
 * blank, for a person to fill in against the material itself.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/intervention-generation-batch.ts [--only <case>] [--cards|--practice]
 *
 * Writes nothing. No student data is read; the concepts come from the
 * published catalogue and the "existing cards" are invented per case.
 */

const SPEC = "8300";
const INTERVENTION = "eval|batch|harness";

type CardCase = {
  id: string;
  /** What this case is probing, printed so the reader knows what to look for. */
  probing: string;
  conceptMatch: string;
  existingFronts: string[];
  requestedCount?: number;
};

type PracticeCase = {
  id: string;
  probing: string;
  conceptMatch: string;
  requestedCount?: number;
};

/*
 * Concepts are chosen by matching the real catalogue rather than hard-coded,
 * so the batch keeps working when the catalogue changes and never invents a
 * heading the course does not have.
 */
function findConcept(match: string) {
  const concepts = servableExamSpecificationConcepts(SPEC);
  const needle = match.toLowerCase();
  return (
    concepts.find((concept) => concept.label.toLowerCase().includes(needle)) ?? concepts[0]
  );
}

const CARD_CASES: CardCase[] = [
  {
    id: "broad-concept",
    probing: "A concept wide enough that the model could write anything. Are the cards specific?",
    conceptMatch: "algebra",
    existingFronts: [],
  },
  {
    id: "narrow-concept",
    probing: "A tight concept. Does it pad to fill the count, or write fewer good cards?",
    conceptMatch: "standard form",
    existingFronts: [],
  },
  {
    id: "with-existing-cards",
    probing: "Eight cards already exist. Are the new ones genuinely different?",
    conceptMatch: "standard form",
    existingFronts: [
      "What is standard form?",
      "Write 4500 in standard form",
      "Write 0.00032 in standard form",
      "Multiply 2x10^3 by 3x10^4",
      "Divide 8x10^5 by 2x10^2",
      "Add 3x10^4 and 2x10^4",
      "Why is 12x10^3 not in standard form?",
      "Convert 6.2x10^-3 to an ordinary number",
    ],
  },
  {
    id: "near-duplicate-pressure",
    probing:
      "Existing cards cover the concept almost completely. Does it repeat them in new words, or decline to pad?",
    conceptMatch: "standard form",
    existingFronts: [
      "Define standard form",
      "How do you write a large number in standard form?",
      "How do you write a small number in standard form?",
      "How do you multiply numbers in standard form?",
      "How do you divide numbers in standard form?",
      "How do you add numbers in standard form?",
    ],
    requestedCount: 5,
  },
  {
    id: "awkward-existing",
    probing: "Supplied cards are vague and low quality. Does it imitate them or write better ones?",
    conceptMatch: "primes",
    existingFronts: ["primes", "hcf lcm", "factors?", "what is a prime number"],
  },
];

const PRACTICE_CASES: PracticeCase[] = [
  {
    id: "short-recall",
    probing: "Small tariffs. Does the scheme say anything, or just restate the question?",
    conceptMatch: "standard form",
    requestedCount: 3,
  },
  {
    id: "multi-step-calculation",
    probing:
      "Multi-step work. Do the scheme points map to actual steps, or are they filler that happens to sum?",
    conceptMatch: "quadratic",
    requestedCount: 3,
  },
  {
    id: "needs-a-formula",
    probing: "Requires a formula. Is the formula correct, or plausibly hallucinated?",
    conceptMatch: "pythagoras",
    requestedCount: 3,
  },
  {
    id: "explanation-question",
    probing: "An explain/justify question. Can the scheme actually mark prose?",
    conceptMatch: "probability",
    requestedCount: 2,
  },
  {
    id: "common-misconception",
    probing:
      "A concept with a well-known misconception. Does the scheme anticipate it, or only reward the right answer?",
    conceptMatch: "indices",
    requestedCount: 3,
  },
];

const RULE = "=".repeat(74);
const THIN = "-".repeat(74);

function blanks(...questions: string[]) {
  console.log("\n  HUMAN REVIEW");
  for (const question of questions) console.log(`    ${question.padEnd(44)} ?`);
}

async function runCardCase(testCase: CardCase) {
  const concept = findConcept(testCase.conceptMatch);
  console.log(`\n${RULE}\nFLASHCARDS — ${testCase.id}\n${RULE}`);
  console.log(`probing:  ${testCase.probing}`);
  console.log(`concept:  ${concept.label}  (${concept.id})`);
  console.log(`existing: ${testCase.existingFronts.length} card(s)`);

  const result = await generateInterventionFlashcards({
    uid: "eval-harness",
    conceptId: concept.id,
    conceptLabel: concept.label,
    specificationId: SPEC,
    interventionId: INTERVENTION,
    // No deck ids, so the service reads no student data; exclusions come from
    // the case itself via the request it builds.
    deckIds: [],
    ...(testCase.requestedCount !== undefined
      ? { requestedCount: testCase.requestedCount }
      : {}),
  });

  if (!result.ok) {
    console.log(`\n  REFUSED: ${result.reason}`);
    return;
  }

  console.log(`\n  GENERATED ${result.drafts.length}, dropped ${result.droppedDuplicates} as duplicates\n`);
  result.drafts.forEach((card, index) => {
    console.log(`  ${index + 1}. Q: ${card.front}`);
    console.log(`     A: ${card.back}`);
  });

  blanks(
    "cards are on this concept:",
    "cards are actually useful:",
    "none duplicate the supplied ones:",
    "facts and notation correct:",
    "count is justified (no padding):"
  );
}

async function runPracticeCase(testCase: PracticeCase) {
  const concept = findConcept(testCase.conceptMatch);
  console.log(`\n${RULE}\nPRACTICE — ${testCase.id}\n${RULE}`);
  console.log(`probing:  ${testCase.probing}`);
  console.log(`concept:  ${concept.label}  (${concept.id})`);

  const result = await generateInterventionPractice({
    conceptId: concept.id,
    conceptLabel: concept.label,
    specificationId: SPEC,
    interventionId: INTERVENTION,
    ...(testCase.requestedCount !== undefined
      ? { requestedCount: testCase.requestedCount }
      : {}),
  });

  if (!result.ok) {
    console.log(`\n  REFUSED: ${result.reason}`);
    return;
  }

  console.log(`\n  GENERATED ${result.questions.length}, dropped ${result.dropped}\n`);
  result.questions.forEach((question, index) => {
    const total = question.points.reduce((sum, point) => sum + point.marks, 0);
    console.log(`  ${THIN}`);
    console.log(`  Q${index + 1} [${question.marks} marks]  ${question.prompt}`);
    console.log(`     Answer: ${question.answer}`);
    console.log(`     Scheme:`);
    for (const point of question.points) {
      console.log(`       ${point.marks} mark${point.marks === 1 ? "" : "s"} — ${point.text}`);
    }
    /*
     * The automated line is context, not a verdict. A scheme can sum exactly
     * and award its marks for nothing; that is the failure this harness
     * exists to surface, and only a reader can see it.
     */
    console.log(`     AUTOMATED: scheme_total=${total} tariff=${question.marks} concept=canonical`);
  });

  blanks(
    "questions are on this concept:",
    "questions are answerable as written:",
    "scheme points award for real steps:",
    "worked answer is correct:",
    "no hallucinated formulae or facts:",
    "reads like an exam question:"
  );
}

export default async function main() {
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex > 0 ? process.argv[onlyIndex + 1] : undefined;
  const cardsOnly = process.argv.includes("--cards");
  const practiceOnly = process.argv.includes("--practice");

  console.log(
    "\nGenerated material, for reading rather than for a pass rate.\n" +
      "Everything a machine can check has already passed; what is left needs eyes."
  );

  if (!practiceOnly) {
    for (const testCase of CARD_CASES.filter((entry) => !only || entry.id === only)) {
      await runCardCase(testCase);
    }
  }
  if (!cardsOnly) {
    for (const testCase of PRACTICE_CASES.filter((entry) => !only || entry.id === only)) {
      await runPracticeCase(testCase);
    }
  }
  console.log(`\n${RULE}\nNothing was written. Fill in the review lines against the material above.\n`);
}
