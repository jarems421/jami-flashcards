import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";

/**
 * Handwritten extended writing, and a science answer marked by level.
 *
 * Marking had been measured on handwritten maths (point by point) and on typed
 * English (by level), and never on the two things students most often write at
 * length in ink: an essay, and a science explanation judged as a whole. The
 * Understanding Standards folders hold both, with an examiner's commentary for
 * every script.
 *
 * Every value below was read off the PDFs themselves -- the question papers,
 * the 2022 marking instructions and the commentaries -- rather than parsed,
 * because there are thirteen records and a parser would be more code than the
 * data it reads. Where an answer runs on to a page with no candidate label, the
 * page is listed after the labelled one, so the loader shows the continuation
 * instead of dropping it.
 *
 *   node scripts/run-ts.mjs scripts/eval/build-sqa-extended-corpus.ts
 *
 * Measure-only: Understanding Standards material may be used privately but not
 * reproduced commercially, so none of this ships.
 */

const DATASETS = "C:\\Users\\jarem\\jami-datasets";
const CHEMISTRY = join(DATASETS, "sqa-higher-chemistry", "2022-23-h-chemistry-qp2-open-questions-candidate-evidence.pdf");
const HISTORY = (candidate: number) =>
  join(DATASETS, "sqa-higher-history", `2022-23-h-history-qp-1-candidate-evidence-candidate-${candidate}.pdf`);

/** SQA's own open-question scheme, from the 2022 Paper 2 marking instructions, in the levels notation the adapter reads. */
const OPEN_QUESTION_SCHEME = [
  "This is an open-ended question. The answer does not need to be 'excellent' or 'complete' for the candidate to gain full marks.",
  "Level 0: No understanding (0-0 marks)",
  "The candidate has not demonstrated, at an appropriate level, an understanding of the chemistry involved. There is no evidence that they have recognised the area of chemistry involved, or they have not given any statement of a relevant chemistry principle. Award zero marks also if the candidate merely restates the chemistry given in the question.",
  "Level 1: Limited understanding (1-1 marks)",
  "The candidate has demonstrated, at an appropriate level, a limited understanding of the chemistry involved. They have made some statement(s) that are relevant to the situation, showing that they have understood at least a little of the chemistry within the problem.",
  "Level 2: Reasonable understanding (2-2 marks)",
  "The candidate has demonstrated, at an appropriate level, a reasonable understanding of the chemistry involved. They make some statement(s) that are relevant to the situation, showing that they have understood the problem.",
  "Level 3: Good understanding (3-3 marks)",
  "A good understanding of the chemistry involved. The candidate shows a good comprehension of the chemistry of the situation and provides a logically correct answer to the question posed. This type of response might include a statement of the principles involved, a relationship or an equation, and the application of these to respond to the problem.",
].join("\n");

/** The 2022 Higher History essay grid, as the marking instructions print it, in the notation the adapter reads. */
const ESSAY_SCHEME = [
  "B3 Historical context: two points of relevant background to the issue, and the key factors identified and connected to the line of argument.",
  "B6 Use of knowledge: one mark for each relevant point of knowledge that is developed (additional detail, exemplification, reasons or evidence) and used to respond to the demands of the question.",
  "B6 Analysis: one mark for each analytical comment -- links between factors or within a factor, contradictions, similarities, different interpretations, relative importance.",
  "B4 Evaluation: reasoned evaluative comments that make a judgement on the issue -- the extent to which evidence supports a factor, relative importance, counter-arguments, overall impact -- building a balanced line of argument.",
  "B3 Conclusion: a relative overall judgement of the factors, connected to the evidence presented, with reasons for that judgement.",
].join("\n");

const CHEMISTRY_PROMPTS: Record<string, string> = {
  q3:
    "Atoms of different elements have different attractions for bonding electrons. Electronegativity is a measure of the attraction an atom involved in a bond has for the electrons in the bond.\n\n" +
    "Using your knowledge of chemistry, discuss the importance of electronegativity in bonding, structure and properties of compounds.",
  q9:
    "For a particular set of reaction conditions, the actual yield is the quantity of desired product made in a reaction. Some examples of reactions with their desired products are shown: Ba(NO3)2(aq) + Na2SO4(aq) -> BaSO4(s) + 2NaNO3(aq), desired product BaSO4(s); CH3OH(l) + C2H5COOH(l) <=> C2H5COOCH3(l) + H2O(l), desired product C2H5COOCH3(l); Mg(s) + 2HCl(aq) -> MgCl2(aq) + H2(g), desired product H2(g).\n\n" +
    "Using your knowledge of chemistry, describe how the actual yield in a reaction could be determined. Your answer should include experimental procedures that could be used to determine the quantity of product made in reactions such as the examples shown in the table.",
};

/** Question, candidate, examiner's award, and the pages the answer is on. */
const CHEMISTRY_ANSWERS: Array<{ question: "q3" | "q9"; candidate: number; awarded: number; pages: number[] }> = [
  { question: "q3", candidate: 1, awarded: 1, pages: [1] },
  { question: "q3", candidate: 2, awarded: 1, pages: [1, 2] },
  { question: "q3", candidate: 3, awarded: 2, pages: [3] },
  { question: "q3", candidate: 4, awarded: 2, pages: [4] },
  { question: "q3", candidate: 5, awarded: 3, pages: [5] },
  { question: "q9", candidate: 1, awarded: 1, pages: [6] },
  { question: "q9", candidate: 2, awarded: 1, pages: [6] },
  { question: "q9", candidate: 3, awarded: 2, pages: [7] },
  { question: "q9", candidate: 4, awarded: 2, pages: [8] },
  { question: "q9", candidate: 5, awarded: 3, pages: [9] },
  { question: "q9", candidate: 6, awarded: 3, pages: [10, 11] },
];

const ESSAYS: Array<{ candidate: number; question: string; prompt: string; awarded: number; pages: number }> = [
  {
    candidate: 1,
    question: "q14",
    prompt: "Part D – Britain 1851-1951. Some women gained the vote in 1918 due to changing attitudes to women in society. How valid is this view?",
    awarded: 21,
    pages: 8,
  },
  {
    candidate: 2,
    question: "q16",
    prompt: "Part D – Britain 1851-1951. To what extent were the Liberal social welfare reforms effective in meeting the needs of the British people?",
    awarded: 17,
    pages: 5,
  },
];

export default async function main() {
  const records: MarkingCorpusRecord[] = [
    ...CHEMISTRY_ANSWERS.map((answer): MarkingCorpusRecord => ({
      id: `sqa-ext:chemistry-2022:${answer.question}:c${answer.candidate}`,
      sourceId: "sqa-extended-response",
      level: "alevel",
      levelDetail: "Higher",
      subject: "chemistry",
      regime: "banded",
      questionId: answer.question,
      questionPrompt: CHEMISTRY_PROMPTS[answer.question],
      markScheme: OPEN_QUESTION_SCHEME,
      answer: { kind: "image", paths: answer.pages.map((page) => `${CHEMISTRY}#page=${page}`) },
      humanMarks: [answer.awarded],
      maxMarks: 3,
    })),
    ...ESSAYS.map((essay): MarkingCorpusRecord => ({
      id: `sqa-ext:history-2022:${essay.question}:c${essay.candidate}`,
      sourceId: "sqa-extended-response",
      level: "alevel",
      levelDetail: "Higher",
      subject: "history",
      regime: "additive",
      questionId: essay.question,
      questionPrompt: essay.prompt,
      markScheme: ESSAY_SCHEME,
      answer: { kind: "image", paths: [`${HISTORY(essay.candidate)}#page=1-${essay.pages}`] },
      humanMarks: [essay.awarded],
      maxMarks: 22,
    })),
  ];
  const target = resolve("artifacts/corpus/sqa-extended-response.json");
  mkdirSync(resolve("artifacts/corpus"), { recursive: true });
  writeFileSync(target, JSON.stringify({ records, stats: { records: records.length }, issues: [] }, null, 2));
  process.stdout.write(`${records.length} records written to ${target}\n`);
}
