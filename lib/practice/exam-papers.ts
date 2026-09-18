import { sameExamTier } from "@/lib/practice/exam-course-tiers";
import type { ExamCourseSelection, ExamQuestion } from "@/lib/practice/exam-questions";

/**
 * The papers a course is sat as, in the words a student uses for them.
 *
 * "Which paper?" is the question every subject shares; "calculator or not" is
 * only maths's way of asking it. Economics is Paper 1 and Paper 2 because one
 * is micro and one is macro, biology is split by topic -- so the picker offers
 * the course's own papers and lets the calculator question appear only where a
 * paper actually has a calculator rule.
 */
export type ExamCoursePaper = {
  /** Stable across tiers: Paper 1 Foundation and Paper 1 Higher are one paper. */
  id: string;
  /** "Paper 1". */
  label: string;
  /** Whatever else the board's title says about it, e.g. "Markets and business behaviour". */
  detail?: string;
  /**
   * The part of the course the paper belongs to, on a course sat as more than
   * one subject: "Biology" for Combined Science's Biology Paper 1.
   *
   * Read off the words the board prints before the paper number -- the same
   * words `examPaperKey` already uses to keep three Paper 1s apart -- so it
   * needs nothing the catalogue does not already say.
   */
  group?: string;
};

/**
 * A paper's label with its course part taken off: "Biology Paper 1" is
 * "Paper 1" once a student has already said they are doing Biology.
 */
export function examPaperLabelWithin(paper: ExamCoursePaper, group: string) {
  if (!group || paper.group !== group) return paper.label;
  return paper.label.slice(group.length).trim() || paper.label;
}

const NUMBERED = /\b(paper|component|unit)\s*0*(\d+)\b/i;
const TIER_WORDS = /\b(foundation|higher)(\s+tier)?\b/gi;

const slug = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * What a title says before its paper number, which is which paper it is.
 *
 * A combined course numbers each subject's papers from one: AQA's Combined
 * Science is Biology Paper 1, Chemistry Paper 1 and Physics Paper 1, all
 * "Paper 1". Read by number alone they collapsed into a single paper, so a
 * student asking for Chemistry Paper 1 was handed Biology and Physics as well.
 * The words before the number keep them apart. A title with none -- "Paper 1
 * Higher", "Paper 1 (Non-Calculator)" -- is read exactly as before.
 */
function paperPrefix(title: string, numbered: RegExpMatchArray) {
  return title
    .slice(0, numbered.index ?? 0)
    .replace(TIER_WORDS, "")
    .replace(/[^A-Za-z\s]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Which paper a component is, told apart by its number rather than its code.
 *
 * Codes are not written one way: the catalogue lists AQA's `1H` where an
 * ingested question may carry `8300/1H`. The number in the title is the part
 * both agree on, and it is also the part that ignores tier.
 */
export function examPaperKey(title: string, code = "") {
  const numbered = title.match(NUMBERED);
  if (numbered) {
    const key = `${numbered[1].toLowerCase()}-${Number(numbered[2])}`;
    const prefix = slug(paperPrefix(title, numbered));
    return prefix ? `${prefix}-${key}` : key;
  }
  const fromCode = code.split("/").at(-1)?.match(/^0*(\d+)[a-z]?$/i);
  if (fromCode) return `paper-${Number(fromCode[1])}`;
  const plain = title.replace(TIER_WORDS, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return plain || code.trim().toLowerCase();
}

function describePaper(title: string, code: string): Omit<ExamCoursePaper, "id"> {
  const numbered = title.match(NUMBERED);
  if (!numbered) {
    const label = title.replace(TIER_WORDS, "").replace(/\s{2,}/g, " ").trim() || code;
    return { label };
  }
  const word = numbered[1][0].toUpperCase() + numbered[1].slice(1).toLowerCase();
  const prefix = paperPrefix(title, numbered);
  const detail = title
    .slice((numbered.index ?? 0) + numbered[0].length)
    .replace(TIER_WORDS, "")
    .replace(/[()]/g, " ")
    .replace(/^[\s:–—·,-]+|[\s:–—·,-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const label = `${prefix ? `${prefix} ` : ""}${word} ${Number(numbered[2])}`;
  return { label, ...(detail ? { detail } : {}), ...(prefix ? { group: prefix } : {}) };
}

/**
 * A course's papers, from its catalogue entries, for the student's tier.
 *
 * Both tiers' entries describe the same papers, so they are merged by number,
 * and the first title that says what a paper is about supplies its detail.
 */
export function examCoursePapers(
  entries: ReadonlyArray<Record<string, unknown>>,
  course: Pick<ExamCourseSelection, "tier">
): ExamCoursePaper[] {
  const papers = new Map<string, ExamCoursePaper>();
  for (const entry of entries) {
    const code = typeof entry.componentCode === "string" ? entry.componentCode.trim() : "";
    const title = typeof entry.componentTitle === "string" ? entry.componentTitle.trim() : "";
    if (!code && !title) continue;
    const tier = typeof entry.tier === "string" ? entry.tier.trim() : "";
    if (tier && course.tier && !sameExamTier(tier, course.tier)) continue;
    const id = examPaperKey(title, code);
    /*
     * What the board says about the paper, where the rollout records it.
     * Otherwise the detail is whatever the component's title carries after its
     * number, which tells a student the paper's subject but not its shape.
     */
    const written = typeof entry.componentDescription === "string" ? entry.componentDescription.trim() : "";
    const described = describePaper(title, code);
    const detailed = written ? { ...described, detail: written } : described;
    const existing = papers.get(id);
    if (!existing) papers.set(id, { id, ...detailed });
    else if (written) existing.detail = written;
    else if (!existing.detail && described.detail) existing.detail = described.detail;
  }
  return [...papers.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true })
  );
}

/**
 * Whether to ask about a calculator at all.
 *
 * A calculator rule belongs to a paper -- AQA GCSE Maths Paper 1 is
 * non-calculator, Papers 2 and 3 allow one -- so once a single paper is chosen
 * the question is already answered. Offering it anyway let a student pick
 * Paper 3 and then "Non-calculator", a combination no question satisfies. It is
 * asked across all papers only, on a course whose papers carry a rule, or while
 * a choice already made is still in force.
 */
export function examCalculatorChoiceOffered(input: {
  paperChosen: boolean;
  policyKnown: boolean;
  calculatorChosen: boolean;
}) {
  return !input.paperChosen && (input.policyKnown || input.calculatorChosen);
}

export function matchesPaperChoice(
  question: Pick<ExamQuestion, "provenance">,
  paperIds: readonly string[]
) {
  if (paperIds.length === 0) return true;
  return paperIds.includes(
    examPaperKey(question.provenance.componentTitle ?? "", question.provenance.componentCode ?? "")
  );
}

/**
 * Each paper described by its calculator rule, where its title does not say.
 *
 * AQA's catalogue names its maths papers "Paper 1 Higher", which tells a
 * student nothing to choose by, while every question ingested from the paper
 * records whether a calculator was allowed. The rule is stated only when every
 * question from that paper agrees: a paper whose questions disagree, or record
 * nothing, stays undescribed rather than described wrongly.
 */
export function withPaperCalculatorRules(
  papers: readonly ExamCoursePaper[],
  questions: ReadonlyArray<Pick<ExamQuestion, "calculatorAllowed" | "provenance">>
): ExamCoursePaper[] {
  const rules = new Map<string, Set<boolean | undefined>>();
  for (const question of questions) {
    const key = examPaperKey(question.provenance.componentTitle ?? "", question.provenance.componentCode ?? "");
    const seen = rules.get(key) ?? new Set<boolean | undefined>();
    seen.add(typeof question.calculatorAllowed === "boolean" ? question.calculatorAllowed : undefined);
    rules.set(key, seen);
  }
  return papers.map((paper) => {
    if (paper.detail && /calculator/i.test(paper.detail)) return paper;
    const seen = [...(rules.get(paper.id) ?? [])];
    if (seen.length !== 1 || seen[0] === undefined) return paper;
    const rule = seen[0] ? "Calculator allowed" : "Non-calculator";
    return { ...paper, detail: paper.detail ? `${paper.detail} · ${rule}` : rule };
  });
}
