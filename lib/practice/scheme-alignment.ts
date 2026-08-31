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
 *   q6  asked for an experimental design over a 20-word-pair study; its scheme
 *       answered a serial-position scenario about revising topics on a bus.
 *   q3  asked which type of social influence a study-group remark shows; its
 *       scheme explained recycling, a head student, and 68% and 12% figures
 *       that appear nowhere in the question.
 *
 * A student sitting that paper is marked against an answer to a question they
 * were never asked.
 *
 * The first version of this measured what fraction of a question's distinctive
 * terms its scheme repeated. That worked on the paper it was built from and
 * failed on the next one, refusing three correct schemes: "Outline the encoding
 * and capacity of short-term memory" answered by "Encoding: acoustic; capacity:
 * approximately 7 +/- 2 items", which is exactly right and repeats almost
 * nothing, and a 16-mark obedience question whose scheme cited 100% from a real
 * study. A right answer does not restate its question, and in this subject a
 * scheme quotes research figures constantly.
 *
 * So the tests below are the narrow ones that separated the two papers rather
 * than the general ones that looked reasonable. Each trades recall for
 * precision on purpose: a false positive burns repair rounds and blocks a good
 * paper, and this is not the only gate a scheme has to pass.
 */

/**
 * Words too common to say what a question is about.
 *
 * Command words are deliberately here: "discuss" appearing in both a question
 * and its scheme is no evidence they concern the same topic.
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
 * The question with its tariff removed.
 *
 * "[16 marks]" is not a figure a candidate is given to work with, and reading
 * it as one makes every extended question look as though it carries data.
 */
const withoutTariff = (prompt: string) =>
  String(prompt ?? "")
    .replace(/\[?\s*\d+\s*marks?\s*\]?/gi, " ")
    /**
     * And ages, which are description rather than data.
     *
     * "A researcher observed a mother and her 8-month-old infant" gives a
     * scheme nothing it must quote back: a correct answer about interactional
     * synchrony never mentions the eight, and two correct schemes were refused
     * for it. "20 word pairs" is the other kind of number -- the study's own
     * design, which a scheme answering that study does use.
     */
    .replace(/\b\d+[-\s]?(?:month|year|week|day)s?[-\s]?old\b/gi, " ");

/**
 * Does this question hand the candidate a situation?
 *
 * A scenario is where a scheme's figures have to match the question's, because
 * both describe the same invented situation. A bare "Discuss research into
 * obedience" carries no situation, and its scheme citing a study that found
 * 100% obedience is doing its job. The wrong schemes sat under questions of 241
 * and 361 characters; the correct schemes wrongly refused sat under 70 and 110.
 */
const carriesScenario = (prompt: string) => withoutTariff(prompt).trim().length >= 140;

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
  const scenario = carriesScenario(question.prompt);

  /**
   * Nothing at all in common.
   *
   * Not a low fraction -- none. The wrong scheme for "Outline what is meant by
   * interference as an explanation of forgetting" shared zero of its four
   * terms; the correct scheme for "Outline the encoding and capacity of
   * short-term memory" shares two of eight and was refused by the fraction
   * test. Two schemes on the same topic always share some word; two schemes for
   * different questions often share none.
   */
  if (question.marks >= 2 && asked.size >= 3) {
    const shared = [...asked].filter((word) => answered.has(word));
    if (shared.length === 0) {
      fail(
        "scheme_off_topic",
        `The scheme for a ${question.marks}-mark question shares none of its ${asked.size} key terms. ` +
          "It may belong to a different question."
      );
    }
  }

  if (scenario) {
    /**
     * Figures in a scenario's scheme that the scenario never gave.
     *
     * The scheme crediting "68% of pupils reported recycling" against a
     * question about a study group was caught by this. A scheme citing 100%
     * obedience under "Discuss research into obedience" is quoting a study, and
     * that question carries no scenario, so it is left alone.
     */
    const invented = [...percentages(prose)].filter(
      (value) => !percentages(question.prompt).has(value)
    );
    if (invented.length > 0) {
      fail(
        "scheme_foreign_figures",
        `The scheme credits figures this scenario never gives: ${invented.join(", ")}.`
      );
    }

    /**
     * A scenario's own figures, ignored by its scheme, was tried here and
     * removed.
     *
     * It caught the scheme about revising on a bus attached to a question about
     * 20 word pairs, and it also refused a correct six-point scheme on
     * correlation because the question said "50 adults" and the scheme -- quite
     * properly -- never repeated the fifty. One true finding and one false one
     * is not a rate at which a check may block a paper, and a sample size is
     * not meaningfully different from an age. Stripping ages was enough to save
     * two other correct schemes; there was no honest line left to draw here.
     *
     * The cost is real: a wrong scheme sharing one word with its question, as
     * that one did, is no longer caught by anything.
     */
  }

  /**
   * A scheme that credits what the question was supposed to name, when it named
   * nothing.
   *
   * "Discuss resistance to social influence. [16 marks]" was marked against a
   * scheme reading "both explanations named in the stem". The stem names none.
   */
  const claimsStem = /named in the stem|in the stem|given in the question|stated in the question|named above|named in the question/i;
  const namesSomething = /\band\b|,|:/.test(question.prompt) || asked.size >= 8;
  if (claimsStem.test(prose) && !namesSomething) {
    fail(
      "scheme_assumes_unstated_stem",
      "The scheme credits content it says the question names, and the question names none of it. " +
        "Either name it in the question or stop requiring it."
    );
  }

  /**
   * The shape of the scheme against what the question asks for.
   *
   * An extended "discuss" needs levels: there is no list of points that makes a
   * sixteen-mark argument creditable one tick at a time. A one-mark "identify"
   * needs the opposite.
   */
  const command = /\b(identify|name|state|define|outline|describe|discuss|evaluate)\b/i.exec(question.prompt);
  const verb = command ? command[1].toLowerCase() : "";
  const model = (item as { marking?: string }).marking;
  if (["discuss", "evaluate"].includes(verb) && question.marks >= 10) {
    if (model !== "banded" && model !== "weightedTraits") {
      fail(
        "scheme_shape_mismatch",
        `A ${question.marks}-mark "${verb}" needs a banded or trait scheme; this one is ${model}.`
      );
    }
  }
  if (["identify", "name", "state"].includes(verb) && question.marks <= 2 && model === "banded") {
    fail(
      "scheme_shape_mismatch",
      `A ${question.marks}-mark "${verb}" is right or wrong; a banded scheme cannot mark it.`
    );
  }

  /**
   * Level numbers must rise with the marks they award.
   *
   * The published paper labelled its top band "Level 1" and its zero band
   * "Level 5". The ranges were right, so every structural check passed, and a
   * marker reading "Level 5" awards the bottom of the scale for the best answer
   * in front of them.
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
