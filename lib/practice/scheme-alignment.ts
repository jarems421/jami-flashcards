import type { MarkSchemeIssue } from "@/lib/practice/mark-schemes";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/practice-papers";

/**
 * Whether a mark scheme is about the question it is attached to.
 *
 * Everything that validated a scheme until now checked its shape: that bands
 * were contiguous, that points summed, that a pool was really a pool. A paper
 * passed all of it, passed a whole-paper audit, passed an independent re-audit
 * returning {"pass":true,"issues":[]}, and was published with three schemes
 * belonging to a different paper:
 *
 *   q5  asked what interference is; its scheme answered STM encoding and
 *       capacity, "acoustic, 7 +/- 2 items".
 *   q6  asked for an experimental design and one advantage; its scheme answered
 *       a serial-position scenario about revising topics on a bus.
 *   q3  asked which type of social influence a study-group remark shows; its
 *       scheme explained recycling, a head student, and 68% and 12% figures
 *       that appear nowhere in the question.
 *
 * A student sitting that paper is marked against an answer to a question they
 * were never asked. Nothing in the pipeline could see it, because every check
 * asked whether the scheme was well-formed and none asked what it was about.
 *
 * The thresholds here are set from that paper: the three wrong schemes cover
 * 0.00, 0.12 and 0.30 of their question's distinctive terms, and the fifteen
 * right ones cover 0.46 to 1.00. The gap is wide and the cut sits inside it.
 */

/**
 * Words too common to say what a question is about.
 *
 * Command words are deliberately here: "discuss" appearing in both a question
 * and its scheme is no evidence they concern the same topic, and counting it
 * lifts every score toward the threshold from below.
 */
const COMMON = new Set([
  "which", "because", "there", "these", "those", "would", "could", "should",
  "about", "other", "using", "named", "state", "given", "marks", "answer",
  "question", "students", "student", "people", "person", "study", "research",
  "psychologist", "following", "situation", "explain", "outline", "describe",
  "discuss", "identify", "suggest", "briefly", "above", "below", "include",
  "referring", "refer", "their", "your", "with", "that", "this", "from",
  "have", "been", "were", "when", "where", "what", "into", "more", "than",
  "each", "both", "also", "such", "used", "does",
]);

const distinctive = (text: string) =>
  new Set(
    String(text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 5 && !COMMON.has(word))
  );

/** Everything the scheme says, wherever the marking model puts it. */
function schemeProse(item: PracticePaperMarkSchemeItem) {
  const parts: string[] = [item.answer ?? ""];
  const record = item as unknown as Record<string, unknown>;
  for (const point of (record.points as { text?: string }[]) ?? []) {
    parts.push(point?.text ?? "");
  }
  for (const band of (record.bands as { descriptor?: string; label?: string }[]) ?? []) {
    parts.push(band?.descriptor ?? "", band?.label ?? "");
  }
  for (const trait of (record.traits as { label?: string; bands?: { descriptor?: string }[] }[]) ?? []) {
    parts.push(trait?.label ?? "");
    for (const band of trait.bands ?? []) parts.push(band?.descriptor ?? "");
  }
  parts.push(...(item.acceptableAlternatives ?? []), ...(item.commonMistakes ?? []));
  return parts.join(" ");
}

/**
 * Percentages the scheme states and the question does not.
 *
 * Only percentages. Matching bare numbers finds band boundaries and point ids
 * -- "11.2", "0-3" -- in almost every correct scheme, which is noise. A figure
 * a candidate is told to use, that they were never given, is a scenario from
 * somewhere else: the wrong scheme's 68% and 12% were caught by this and by
 * nothing else, its prose overlap being high enough to pass on its own.
 */
const percentages = (text: string) =>
  new Set((String(text ?? "").match(/\d+(?:\.\d+)?\s?%/g) ?? []).map((value) => value.replace(/\s/g, "")));

/** The integer in "Level 3", if the label carries one. */
const levelNumber = (label: string | undefined) => {
  const match = /(\d+)/.exec(String(label ?? ""));
  return match ? Number(match[1]) : null;
};

export function schemeAlignmentIssues(
  question: { id: string; prompt: string; marks: number },
  item: PracticePaperMarkSchemeItem
): MarkSchemeIssue[] {
  const issues: MarkSchemeIssue[] = [];
  const fail = (code: string, detail: string) =>
    issues.push({ questionId: question.id, code, detail });

  const prose = schemeProse(item);
  const asked = distinctive(question.prompt);
  const answered = distinctive(prose);

  /**
   * From two marks up. A one-mark "identify" is answered in two words -- "the
   * psychodynamic approach" -- and legitimately repeats almost nothing of the
   * question; the paper's own 1-mark items score 0.10 and 0.57 and are both
   * correct. Below the tariff where a scheme has to explain itself, this
   * measure says nothing.
   */
  if (question.marks >= 2 && asked.size >= 3) {
    const shared = [...asked].filter((word) => answered.has(word));
    const coverage = shared.length / asked.size;
    if (coverage < 0.38) {
      fail(
        "scheme_off_topic",
        `The scheme for a ${question.marks}-mark question shares ${shared.length} of ${asked.size} ` +
          `key terms with it (${(coverage * 100).toFixed(0)}%). It may belong to a different question.`
      );
    }
  }

  const invented = [...percentages(prose)].filter((value) => !percentages(question.prompt).has(value));
  if (invented.length > 0) {
    fail(
      "scheme_foreign_figures",
      `The scheme credits figures the question never gives: ${invented.join(", ")}.`
    );
  }

  /**
   * Level numbers must rise with the marks they award.
   *
   * The published paper labelled its top band "Level 1" and its zero band
   * "Level 5" on every banded question. The ranges were right, so every
   * structural check passed, and a marker reading "Level 5" awards the bottom
   * of the scale for the best answer in front of them.
   */
  const bands = (item as unknown as { bands?: { label?: string; minMarks: number }[] }).bands ?? [];
  const numbered = bands
    .map((band) => ({ level: levelNumber(band.label), min: band.minMarks }))
    .filter((band): band is { level: number; min: number } => band.level !== null);
  if (numbered.length >= 2) {
    const byMarks = [...numbered].sort((left, right) => left.min - right.min);
    const descending = byMarks.every((band, index) =>
      index === 0 || band.level <= byMarks[index - 1].level
    );
    if (descending) {
      fail(
        "bands_out_of_order",
        `Level ${byMarks[0].level} awards ${byMarks[0].min} marks and ` +
          `Level ${byMarks[byMarks.length - 1].level} awards the most. Level numbers must rise with marks.`
      );
    }
  }

  return issues;
}

/** Every alignment fault across a paper. */
export function paperSchemeAlignmentIssues(
  questions: readonly { id: string; prompt: string; marks: number }[],
  items: readonly PracticePaperMarkSchemeItem[]
) {
  const byId = new Map(items.map((item) => [item.questionId, item]));
  return questions.flatMap((question) => {
    const item = byId.get(question.id);
    return item ? schemeAlignmentIssues(question, item) : [];
  });
}
