import type { PracticePaperAssessmentProfile } from "@/lib/practice/practice-papers";
import { paperHouseStyle } from "@/lib/practice/paper-house-style";
import { questionLevel, type QuestionConvention } from "@/lib/practice/question-conventions";

/**
 * How one board marks one kind of question in one subject, read from its own
 * mark schemes.
 *
 * The hand-written conventions in `question-conventions.ts` cover a few dozen
 * question types from memory, and a rule written from memory is a rule that
 * can be wrong in a way nobody notices until marking drifts. The boards publish
 * this themselves: every mark scheme says how its levels are decided and what
 * each kind of question expects. These rules are extracted from those
 * documents -- the official mark schemes of questions in the Past Paper
 * Practice corpus, and the mark schemes and examiner reports on the boards'
 * own websites -- and every rule says which documents it came from.
 *
 * They are paraphrased practice, never the scheme's own wording: a rule that
 * copies a run of its source is dropped (`copiedSpan`), so no licensed text is
 * carried into a prompt about some other question.
 */

export type QuestionTypeSource = {
  title: string;
  url?: string;
  /** Corpus questions the rule was read from, where it came from the corpus. */
  questionIds?: string[];
};

export type QuestionTypeRule = {
  id: string;
  name: string;
  /** The tariffs this kind of question carries. */
  tariffs: number[];
  commandWords: string[];
  /** Phrases in a question that identify the kind: "Using Figure", "Explain two", "Compare". */
  cues: string[];
  marking: "points" | "levels" | "traits" | "mixed";
  answerShape: string;
  examinerRules: string[];
  pitfalls: string[];
  /** Marks awarded on top of the tariff, e.g. "+3 for spelling, punctuation and grammar". */
  extraMarks?: string;
  sources: QuestionTypeSource[];
};

export type QuestionTypeRuleSet = {
  board: string;
  qualification: "gcse" | "a_level";
  subject: string;
  subjectLabel: string;
  rules: QuestionTypeRule[];
  method: Array<"corpus" | "official_documents">;
  researchedAt: number;
  notes: string[];
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const texts = (value: unknown, max: number, count: number) =>
  (Array.isArray(value) ? value : []).map((item) => text(item, max)).filter(Boolean).slice(0, count);

/**
 * A subject as one key, whatever a paper or a board page calls it: "GCSE (9-1)
 * Geography A", "Geography" and "AQA GCSE Geography" are the same subject.
 */
export function subjectKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(aqa|pearson|edexcel|ocr|wjec|eduqas|ccea|sqa|gcse|igcse|a[- ]?level|as[- ]?level|as|level|advanced|subsidiary|international)\b/g, " ")
    .replace(/\(\s*9\s*[-–]\s*1\s*\)|\b9\s*[-–]\s*1\b|\b\d+(\.\d+)?\b/g, " ")
    .replace(/\b(paper|component|unit|foundation|higher|tier|specification|spec)\b.*$/g, " ")
    .replace(/[^a-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Where a paper's rules are filed: board, qualification and subject, read from its profile. */
export function questionTypeRuleKey(profile: Partial<PracticePaperAssessmentProfile> | undefined, title = "") {
  const board = paperHouseStyle(profile).id;
  const level = questionLevel(profile, title);
  const qualification = level === "gcse" ? "gcse" : level === "alevel" ? "a_level" : null;
  // A Past Paper Practice paper names the qualification ("GCSE") where a
  // generated one names the subject, so the first field that yields a subject wins.
  const subject = [profile?.qualificationOrModule, profile?.specificationOrCourse, title]
    .map((value) => subjectKey(value ?? ""))
    .find(Boolean);
  if (board === "generic" || !qualification || !subject) return null;
  return { board, qualification, subject } as const;
}

/**
 * A subject and its shorter forms, longest first. A paper may name the
 * subject more fully than its rules were filed: "Biology B (Twenty First
 * Century Science)" is filed as "biology-b", "Geography A Geographical Themes"
 * as "geography-a".
 */
export function subjectFallbacks(subject: string) {
  const parts = subject.split("-").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, parts.length - index).join("-")).slice(0, 8);
}

export function ruleSetId(key: { board: string; qualification: string; subject: string }) {
  return `${key.board}__${key.qualification}__${key.subject}`;
}

/**
 * Tariffs however a reply writes them: [6], 6, "6", "2-4" or ["1", "2 to 3"].
 * Only a list of numbers was read before, and a rule written any other way was
 * dropped as having no tariff.
 */
export function readTariffs(value: unknown): number[] {
  const marks = (Array.isArray(value) ? value : [value]).flatMap((item) => {
    if (typeof item === "number") return [item];
    if (typeof item !== "string") return [];
    const range = /^\s*(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:marks?)?\s*$/i.exec(item);
    if (range) {
      const [low, high] = [Number(range[1]), Number(range[2])];
      return high >= low && high - low <= 20 ? Array.from({ length: high - low + 1 }, (_, index) => low + index) : [];
    }
    return (item.match(/\d+/g) ?? []).map(Number);
  });
  return marks.filter((mark) => Number.isInteger(mark) && mark > 0 && mark <= 60);
}

/** What a reply's rule lacks that a marker needs, or null when it has everything. */
export function missingRuleFields(value: unknown): string[] {
  if (!value || typeof value !== "object") return ["everything"];
  const raw = value as Record<string, unknown>;
  return [
    ...(text(raw.name, 140) ? [] : ["name"]),
    ...(readTariffs(raw.tariffs).length ? [] : ["tariff"]),
    ...(text(raw.answerShape, 600) ? [] : ["answer shape"]),
    ...(texts(raw.examinerRules, 400, 8).length ? [] : ["examiner rules"]),
  ];
}

/** A rule as a model returned it, made safe to store: bounded, typed, and dropped when unusable. */
export function normalizeQuestionTypeRule(value: unknown, sources: QuestionTypeSource[]): QuestionTypeRule | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const tariffs = readTariffs(raw.tariffs);
  const name = text(raw.name, 140);
  const answerShape = text(raw.answerShape, 600);
  const examinerRules = texts(raw.examinerRules, 400, 8);
  if (!name || !answerShape || examinerRules.length === 0 || tariffs.length === 0) return null;
  const marking = raw.marking === "levels" || raw.marking === "traits" || raw.marking === "mixed" ? raw.marking : "points";
  const sourceIndexes = (Array.isArray(raw.sourceIndexes) ? raw.sourceIndexes : []).map(Number).filter((index) => sources[index]);
  return withoutAddedTariffs<QuestionTypeRule>({
    id: text(raw.id, 60).replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
    name,
    tariffs: [...new Set(tariffs)].sort((a, b) => a - b),
    commandWords: texts(raw.commandWords, 40, 10),
    cues: texts(raw.cues, 80, 8),
    marking,
    answerShape,
    examinerRules,
    pitfalls: texts(raw.pitfalls, 300, 5),
    ...(text(raw.extraMarks, 120) ? { extraMarks: text(raw.extraMarks, 120) } : {}),
    sources: sourceIndexes.length ? sourceIndexes.map((index) => sources[index]) : sources.slice(0, 3),
  });
}

/** The marks a rule gives on top of its tariff -- 4 for "4 marks for spelling, punctuation and grammar" -- or 0. */
export function extraMarksOf(rule: Pick<QuestionTypeRule, "extraMarks">) {
  // "16 marks of the total 40 are for technical accuracy" is a split inside the tariff, not marks on top of it.
  if (/of the total|within the|included in|part of the/i.test(rule.extraMarks ?? "")) return 0;
  const extra = Number(/(\d+)\s*(?:additional|extra|further)?\s*marks?/i.exec(rule.extraMarks ?? "")?.[1] ?? 0);
  return extra > 0 && extra <= 10 ? extra : 0;
}

/**
 * Whether a question worth `marks` is this kind: one of its tariffs, or one
 * with the extra marks added, since a 16-mark essay with 4 for spelling is
 * often stored as a 20-mark question.
 */
export function ruleCoversMarks(rule: Pick<QuestionTypeRule, "tariffs" | "extraMarks">, marks: number) {
  const extra = extraMarksOf(rule);
  return rule.tariffs.includes(marks) || (extra > 0 && rule.tariffs.includes(marks - extra));
}

/**
 * A rule's tariffs without the ones that are another tariff plus its extra
 * marks, which `ruleCoversMarks` covers anyway. Adding the extra marks to every
 * tariff once invented tariffs no question has: OCR History's 18- and 24-mark
 * essay, with 5 for spelling on the 24 only, was filed under 23 and 29 too.
 * Rules saved that way are read through this, and match exactly as before.
 */
export function withoutAddedTariffs<T extends Pick<QuestionTypeRule, "tariffs" | "extraMarks">>(rule: T): T {
  const extra = extraMarksOf(rule);
  if (!extra) return rule;
  const tariffs = rule.tariffs.filter((mark) => !rule.tariffs.includes(mark - extra));
  return tariffs.length === rule.tariffs.length ? rule : { ...rule, tariffs };
}

const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").split(/\s+/).filter(Boolean);

/**
 * The longest run of words a rule shares with its source, or null when it is
 * short enough to be ordinary phrasing. A rule is paraphrased practice; one
 * that reproduces a stretch of the mark scheme would carry licensed wording
 * into prompts about other questions.
 */
export function copiedSpan(rule: QuestionTypeRule, sourceText: string, minimumWords = 12): string | null {
  const source = words(sourceText);
  if (source.length < minimumWords) return null;
  const grams = new Set<string>();
  for (let index = 0; index + minimumWords <= source.length; index += 1) {
    grams.add(source.slice(index, index + minimumWords).join(" "));
  }
  const fields = [rule.answerShape, ...rule.examinerRules, ...rule.pitfalls];
  for (const field of fields) {
    const ruleWords = words(field);
    for (let index = 0; index + minimumWords <= ruleWords.length; index += 1) {
      const gram = ruleWords.slice(index, index + minimumWords).join(" ");
      if (grams.has(gram)) return gram;
    }
  }
  return null;
}

/**
 * The rule for one question: its tariff must be one the rule covers, and among
 * those the rule whose command words or cues the question uses wins. A tariff
 * alone decides only where one rule claims it, and a tie between a levels rule
 * and a points rule decides nothing.
 *
 * A phrase counts for as many words as it has. Counted as one hit each, a
 * stray "Explain" -- every Edexcel History question ends "Explain your answer"
 * -- plus a one-word cue "for" tied "How far do you agree? Explain your
 * answer", and the 16-mark essay was marked as an 8-mark "explain importance"
 * question. One-word cues are not evidence of anything; one-word command words
 * are, a little.
 */
export function matchQuestionTypeRule(
  rules: readonly QuestionTypeRule[],
  question: { prompt?: string; marks: number }
): QuestionTypeRule | null {
  // No rules is the common case (a subject not yet researched), and it must cost nothing and never throw.
  if (rules.length === 0) return null;
  // Words only, on both sides: "Tick one box" never matched a question printed "Tick (✓) one box."
  const prompt = ` ${plainWords(String(question.prompt ?? ""))} `;
  const marks = Math.round(question.marks);
  const candidates = rules.filter((rule) => ruleCoversMarks(rule, marks));
  if (candidates.length === 0) return null;
  const weight = (phrase: string, minimumWords: number) => {
    const plain = plainWords(phrase);
    const count = plain ? plain.split(" ").length : 0;
    return count >= minimumWords && prompt.includes(` ${plain} `) ? count : 0;
  };
  const total = (phrases: string[], minimumWords: number) =>
    [...new Set(phrases.map(plainWords))].reduce((sum, phrase) => sum + weight(phrase, minimumWords), 0);
  const scored = candidates
    .map((rule) => ({ rule, score: total(rule.commandWords, 1) + total(rule.cues, 2) }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (best.score > 0) {
    const judged = marksByJudgement(best.rule.marking);
    // A tie between two descriptions of one way of marking is harmless -- the broad and the
    // specific rule for a points question. A tie between levels and points is a guess.
    const tied = scored.filter((entry) => entry.score === best.score);
    if (!tied.every((entry) => marksByJudgement(entry.rule.marking) === judged)) return null;
    /*
     * The evidence decides how the question is marked; within that, the rule written for fewer
     * tariffs is the closer description. AQA English's 8-and-12-mark "language analysis" out-scored
     * the 12-mark rule 13 to 11 on a 12-mark question, and would have handed the marker 8-mark
     * bands. Discounting breadth across every rule instead let 4-mark levels rules beat
     * points-marked calculations in the sciences, and disagreement with the official schemes
     * rose from 16 to 42 questions.
     */
    return scored
      .filter((entry) => entry.score > 0 && marksByJudgement(entry.rule.marking) === judged)
      .map((entry) => ({ ...entry, specific: entry.score / Math.sqrt(entry.rule.tariffs.length) }))
      .sort((left, right) => right.specific - left.specific)[0].rule;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Whether a marking model places an answer by judgement -- one level grid, or
 * a grid per objective -- rather than counting creditworthy points.
 */
export function marksByJudgement(marking: string) {
  return marking === "levels" || marking === "traits";
}

/** Lower-case words and numbers separated by single spaces, for matching phrases whatever their punctuation. */
function plainWords(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const NAME_NOISE = new Set(["mark", "marks", "paper", "question", "the", "and", "or", "of", "a", "an", "to", "for", "with", "in", "on", "by"]);
const nameWords = (name: string) =>
  new Set(name.toLowerCase().replace(/[^a-z\s]+/g, " ").split(/\s+/).filter((word) => word.length > 2 && !NAME_NOISE.has(word)));

/**
 * One rule per kind of question, however many sources described it.
 *
 * The corpus and the board's website describe the same kinds in their own
 * words: "Language analysis, 8 marks" and "Paper 1 Question 2: Language
 * Analysis (8 marks)" are one question. Two rules sharing a tariff and half
 * the words of their names between them are merged, keeping the fuller rule
 * and both sets of sources.
 */
export function dedupeQuestionTypeRules(rules: readonly QuestionTypeRule[]): QuestionTypeRule[] {
  const kept: QuestionTypeRule[] = [];
  for (const rule of rules) {
    const words = nameWords(rule.name);
    const same = kept.find((existing) => {
      if (!existing.tariffs.some((mark) => rule.tariffs.includes(mark))) return false;
      const theirs = nameWords(existing.name);
      const shared = [...words].filter((word) => theirs.has(word)).length;
      // Half the words of both names, not of the shorter one: "Practical method design" is a
      // narrower kind inside "Extended evaluation, method design or explanation", and keeps its own rules.
      return shared > 0 && shared * 2 >= new Set([...words, ...theirs]).size;
    });
    if (!same) {
      kept.push({ ...rule, sources: [...rule.sources] });
      continue;
    }
    const fuller = rule.examinerRules.length > same.examinerRules.length ? rule : same;
    Object.assign(same, {
      ...fuller,
      id: same.id,
      tariffs: [...new Set([...same.tariffs, ...rule.tariffs])].sort((a, b) => a - b),
      commandWords: [...new Set([...same.commandWords, ...rule.commandWords])].slice(0, 12),
      cues: [...new Set([...same.cues, ...rule.cues])].slice(0, 10),
      pitfalls: rule.pitfalls.length > same.pitfalls.length ? rule.pitfalls : same.pitfalls,
      sources: [...same.sources, ...rule.sources].slice(0, 8),
    });
  }
  return kept;
}

/** A researched rule in the shape the marker and scheme writer already read. */
export function ruleAsConvention(rule: QuestionTypeRule): QuestionConvention {
  return {
    id: `researched:${rule.id}`,
    subject: /./,
    marks: rule.tariffs,
    title: `${rule.name}${rule.extraMarks ? ` (${rule.extraMarks})` : ""}`,
    answerShape: rule.answerShape,
    examinerRules: rule.examinerRules,
    pitfalls: rule.pitfalls.length ? rule.pitfalls : ["None recorded."],
  };
}
