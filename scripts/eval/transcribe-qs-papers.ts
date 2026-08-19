import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { generateAiText } from "@/lib/ai/provider-router";

/**
 * Read the Qualifications Scotland question papers and mark schemes.
 *
 * The criterion benchmark marks handwritten maths against almost nothing: all
 * 89 records carry an empty question prompt, no mark scheme at all, and a
 * description for only 87 of their 361 individual marks. Jami is shown a
 * photograph of somebody's working and a list reading "Mark 1 ... Mark 7". It
 * scores 60.2% at that, which is a floor rather than a measurement of the
 * product, where the paper and its scheme are both present.
 *
 * The source PDFs are on disk and do have a text layer, which is why this is a
 * vision pass rather than a parser. Their maths does not survive extraction:
 *
 *   Given that 5 3 4 10 y x x , where 0 x , find dy dx
 *
 * is Paper 1 question 1. Operators, superscripts and relations are dropped
 * because they sit in symbol fonts with no usable character map, so a text
 * parser would fill the benchmark with plausible-looking nonsense — worse than
 * the blank it replaces, because nonsense is not visibly missing.
 *
 * The output is written for a human to check and is deliberately not wired
 * into the corpus by this script. A hallucinated mark scheme would be marked
 * against and would silently become the standard the benchmark measures, so
 * the twenty-six questions are read against the PDFs before any paid run uses
 * them. Anything unconfirmed is left empty rather than guessed.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/transcribe-qs-papers.ts
 *   ... --confirm
 */

const DATASET = resolve("C:/Users/jarem/jami-datasets/qualifications-scotland");
const OUT = join(DATASET, "transcribed-papers.json");

const TIMEOUT_MS = 300_000;

type TranscribedMark = {
  /** The scheme's own label, matching the commentaries: `Mark 1`, `Mark 2`. */
  id: string;
  /** What the mark is for, in the scheme's words. */
  description: string;
};

type TranscribedQuestion = {
  /** `4(a)(ii)` where the paper splits, `4` where it does not. */
  questionId: string;
  /** The question as printed, with its maths readable. */
  prompt: string;
  /** The generic and illustrative scheme for this question, as printed. */
  scheme: string;
  maxMarks: number | null;
  marks: TranscribedMark[];
};

type TranscribedPaper = {
  paperId: string;
  questions: TranscribedQuestion[];
};

const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionId: { type: "string" },
          prompt: { type: "string" },
          scheme: { type: "string" },
          maxMarks: { type: "number" },
          marks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                description: { type: "string" },
              },
              required: ["id", "description"],
            },
          },
        },
        required: ["questionId", "prompt", "scheme", "maxMarks", "marks"],
      },
    },
  },
  required: ["questions"],
};

const PROMPT = `You are transcribing an official SQA Higher Mathematics question paper and its marking instructions. Both documents are attached: the question paper first, the marking instructions second.

Transcribe, for every numbered question in the paper:

- questionId: the question number exactly as the paper prints it. Use the deepest level the paper splits to, e.g. "4(a)(ii)" where there are parts, "6" where there are none.
- prompt: the question as printed. Write mathematics in plain readable notation — x^5, sqrt(3), integral from a to b, log_5(x), pi. Describe any diagram in one sentence in square brackets rather than omitting it. Do not solve the question.
- scheme: the generic scheme and illustrative scheme for that question from the marking instructions, as printed, including any Notes. Do not include the "Commonly Observed Responses" tables.
- maxMarks: the max mark cell for that question.
- marks: one entry per numbered bullet in the generic scheme, in order. id must be "Mark 1", "Mark 2" and so on, counting from 1 within the question. description is that bullet's wording, e.g. "calculate the y-coordinate".

Rules:
- Transcribe only what is printed. Never infer a mark that is not listed, and never invent wording for one.
- If a question's generic scheme cannot be read, return it with an empty marks array rather than a guess.
- The formulae list and any front matter are not questions.

Return JSON only, matching the supplied schema.`;

const pdfPart = (path: string) => ({
  inlineData: {
    mimeType: "application/pdf",
    data: readFileSync(path).toString("base64"),
  },
});

async function transcribePaper(paperNumber: number): Promise<TranscribedPaper> {
  const questionPaper = join(DATASET, `higher-2023-2023 Question paper ${paperNumber}.pdf`);
  const instructions = join(DATASET, `higher-2023-2023 Marking instructions paper ${paperNumber}.pdf`);
  for (const file of [questionPaper, instructions]) {
    if (!existsSync(file)) throw new Error(`missing ${file}`);
  }

  const text = await generateAiText({
    role: "documentVision",
    request: {
      contents: [
        {
          role: "user",
          parts: [
            { text: `--- QUESTION PAPER ${paperNumber} ---` },
            pdfPart(questionPaper),
            { text: `--- MARKING INSTRUCTIONS PAPER ${paperNumber} ---` },
            pdfPart(instructions),
            { text: PROMPT },
          ],
        },
      ],
    },
    timeoutMs: TIMEOUT_MS,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
      maxOutputTokens: 16_384,
    },
  });

  const parsed = JSON.parse(text) as { questions: TranscribedQuestion[] };
  return { paperId: `paper-${paperNumber}`, questions: parsed.questions ?? [] };
}

export default async function main(args: string[]) {
  if (!args.includes("--confirm")) {
    process.stdout.write(
      `\nThis would send four PDFs to the document vision model and write\n` +
        `  ${OUT}\n` +
        `Nothing has been called. Re-run with --confirm to start.\n`
    );
    return;
  }

  mkdirSync(DATASET, { recursive: true });
  const papers: TranscribedPaper[] = [];
  for (const number of [1, 2]) {
    process.stdout.write(`\nreading paper ${number} ... `);
    const started = Date.now();
    const paper = await transcribePaper(number);
    papers.push(paper);
    process.stdout.write(
      `${paper.questions.length} questions in ${((Date.now() - started) / 1000).toFixed(0)}s\n`
    );
    for (const question of paper.questions) {
      process.stdout.write(
        `  ${question.questionId.padEnd(10)} ${String(question.maxMarks ?? "?").padStart(2)} marks` +
          `  ${question.marks.length} described  ${question.prompt.slice(0, 60)}\n`
      );
    }
  }

  writeFileSync(OUT, `${JSON.stringify({ papers }, null, 2)}\n`);
  process.stdout.write(
    `\nwritten to ${OUT}\n` +
      `Check every question against the PDFs before any run uses this.\n`
  );
}
