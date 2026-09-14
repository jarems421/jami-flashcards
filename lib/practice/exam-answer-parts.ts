import { EXAM_ANSWER_MAX_LENGTH } from "@/lib/practice/exam-questions";

/**
 * Typed answers split by part, for a question that asks for (a), (b) and (c).
 *
 * One answer is still stored and marked per question -- the rules, the drafts
 * and the marker all take a single text -- so the parts are written into it
 * labelled, "(a) ..." then "(b) ...", which is also how an examiner reads a
 * script. The labels are what let a saved draft reopen in the right boxes.
 */

const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ROMANS = ["i", "ii", "iii", "iv", "v", "vi"];
/** Room each label and the blank line between parts take in the saved text. */
const LABEL_OVERHEAD = 8;

/** The labels, in order from the first, while they run without a gap. */
function labelsFrom(found: readonly string[]) {
  const run = (sequence: readonly string[]) => {
    const labels: string[] = [];
    for (const item of sequence) {
      if (!found.includes(item)) break;
      labels.push(`(${item})`);
    }
    return labels;
  };
  const letters = run(LETTERS);
  if (letters.length >= 2) return letters;
  const romans = run(ROMANS);
  return romans.length >= 2 ? romans : [];
}

/**
 * The parts a question's wording asks for, when it asks for two or more.
 *
 * A marker counts only where a part starts -- a new line, or after the end of
 * a sentence -- so "(a)" quoted inside a sentence is not taken for one.
 */
export function detectExamAnswerParts(prompt: string): string[] {
  const found = [
    ...prompt.matchAll(/(?:^|\n|[.:?!]\s)\s*\((iv|vi|v|i{1,3}|[a-h])\)(?=\s)/g),
  ].map((match) => match[1]!);
  return labelsFrom(found);
}

/** The labels a saved answer was written with, when it was written by part. */
export function examAnswerPartLabelsIn(text: string): string[] {
  const found = [...text.trim().matchAll(/(?:^|\n\n)\((iv|vi|v|i{1,3}|[a-h])\) /g)].map(
    (match) => match[1]!
  );
  return labelsFrom(found);
}

/** The label after the last one, or null once the parts run out. */
export function nextExamAnswerPartLabel(labels: readonly string[]): string | null {
  if (labels.length === 0) return "(a)";
  const last = labels[labels.length - 1]!.slice(1, -1);
  const sequence = ROMANS.includes(last) && labels.every((label) => ROMANS.includes(label.slice(1, -1)))
    ? ROMANS
    : LETTERS;
  const next = sequence[sequence.indexOf(last) + 1];
  return sequence.includes(last) && next ? `(${next})` : null;
}

/** The answers, one per part, as the single labelled text that is saved and marked. */
export function joinExamAnswerParts(labels: readonly string[], texts: readonly string[]) {
  return labels
    .map((label, index) => ({ label, text: (texts[index] ?? "").trim() }))
    .filter((part) => part.text)
    .map((part) => `${part.label} ${part.text}`)
    .join("\n\n");
}

/** A saved answer back into its parts' boxes, or null when it was not written by part. */
export function splitExamAnswerParts(text: string, labels: readonly string[]): string[] | null {
  const trimmed = text.trim();
  if (!trimmed) return labels.map(() => "");
  const escaped = labels.map((label) => label.replace(/[()]/g, "\\$&"));
  const matches = [...trimmed.matchAll(new RegExp(`(?:^|\\n\\n)(${escaped.join("|")}) `, "g"))];
  if (matches.length === 0 || matches[0]!.index !== 0) return null;
  const texts = labels.map(() => "");
  matches.forEach((match, index) => {
    const start = match.index! + match[0].length;
    const end = matches[index + 1]?.index ?? trimmed.length;
    texts[labels.indexOf(match[1]!)] = trimmed.slice(start, end).trim();
  });
  return texts;
}

/** How long each part's answer can be, so the parts together stay within one answer's limit. */
export function examAnswerPartMaxLength(partCount: number) {
  return Math.floor(EXAM_ANSWER_MAX_LENGTH / Math.max(1, partCount)) - LABEL_OVERHEAD;
}
