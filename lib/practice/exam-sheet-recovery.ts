import { examQuestionContentVersion } from "@/lib/practice/exam-content-version";
import {
  regionsForQuestion,
  rootQuestionLabel,
  type PdfPageText,
  type QuestionRegion,
  type QuestionStart,
} from "@/lib/practice/exam-page-regions";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/practice-papers";

/**
 * Recovering the slice of paper a stored question was cut from, without
 * asking a model anything.
 *
 * The bank needs a new asset -- the question's pages, one image each, so a
 * student can write on the paper. Everything needed to render them is already
 * on disk: the board's PDF is kept beside the paper, and where a question
 * starts and stops is read off the PDF's own text layer rather than guessed by
 * the model. So no re-extraction is needed, which matters because
 * re-extraction would overwrite every question in the bank and take its
 * human spot-check with it.
 *
 * What it cannot do is *assume*. Rendering the wrong region over a published
 * question would put one question's paper under another question's answer,
 * silently, on a corpus nobody is going to re-read by hand. And the region a
 * question was built from was never stored -- only hashed.
 *
 * Hashed, though, is enough. `contentVersion` covers the wording, the tariff,
 * the scheme, the page, the regions and the source document together, so a
 * candidate set of regions that reproduces the stored version is not a likely
 * match for the original: it is the original, on every input the hash covers.
 * So this searches a small, bounded space of candidates and returns one only on
 * an exact hash match. A question whose version cannot be reproduced is
 * reported and left exactly as it is.
 */

export type ExamSheetRecovery = {
  regions: QuestionRegion[];
  /** The page the extraction recorded, recovered with the regions. */
  page: number;
  /** The label whose margin position the crop was taken from. */
  startLabel: string;
  /** Whether the crop carried its root question's stem. */
  withStem: boolean;
  /** How many candidates were hashed before this one matched. */
  tried: number;
};

/**
 * Labels worth trying, likeliest first.
 *
 * Almost every question matches on its first candidate: the label a question
 * is stored under is the one the crop was taken from. The rest of the paper's
 * margin numbers follow, because a handful of questions are stored under the
 * printed reference the board uses (`03.6`) rather than the margin label the
 * region came from, and there is no way back from one to the other -- only a
 * search, and a hash to settle it.
 */
function candidateLabels(input: {
  starts: readonly QuestionStart[];
  label: string;
  questionNumber: string;
}) {
  const known = new Set<string>();
  const ordered: string[] = [];
  const add = (label: string) => {
    if (!label || known.has(label)) return;
    known.add(label);
    ordered.push(label);
  };

  const printed = new Set(input.starts.map((start) => start.label));
  // Whatever the question calls itself, normalised the way a margin label is.
  for (const raw of [input.questionNumber, input.label]) {
    const digits = raw.replace(/[^0-9a-z.()]/gi, "");
    if (printed.has(digits)) add(digits);
    const root = rootQuestionLabel(raw);
    if (printed.has(root)) add(root);
    // AQA stores `03.6` for the margin's `3.6`; the zero padding is the only
    // difference, and stripping it costs nothing to try.
    const unpadded = digits.replace(/^0+(?=\d)/, "").replace(/\.0+(?=\d)/, ".");
    if (printed.has(unpadded)) add(unpadded);
  }
  for (const start of input.starts) add(start.label);
  return ordered;
}

/**
 * The regions behind a stored question, or null if they cannot be proved.
 *
 * `pageCount` bounds the one input that is not derivable: extraction recorded
 * the page the model claimed the question was on, which is a small integer and
 * is cheaper to search than to reason about.
 */
export function recoverExamQuestionRegions(input: {
  contentVersion: string;
  prompt: string;
  marks: number;
  markSchemeItem: PracticePaperMarkSchemeItem;
  paperSha256: string;
  label: string;
  questionNumber: string;
  starts: readonly QuestionStart[];
  pages: PdfPageText[];
  pageCount: number;
}): ExamSheetRecovery | null {
  const labels = candidateLabels(input);
  let tried = 0;

  for (const startLabel of labels) {
    const root = rootQuestionLabel(startLabel);
    for (const withStem of root && root !== startLabel ? [false, true] : [false]) {
      const regions = regionsForQuestion({
        label: startLabel,
        starts: [...input.starts],
        pages: input.pages,
        ...(withStem ? { withStemOf: root } : {}),
      });
      if (regions.length === 0) continue;
      for (let page = 1; page <= input.pageCount; page += 1) {
        tried += 1;
        const version = examQuestionContentVersion({
          prompt: input.prompt,
          marks: input.marks,
          markSchemeItem: input.markSchemeItem,
          page,
          regions,
          paperSha256: input.paperSha256,
        });
        if (version === input.contentVersion) {
          return { regions, page, startLabel, withStem, tried };
        }
      }
    }
  }
  return null;
}
