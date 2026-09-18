import { normaliseQuestionLabel, rootQuestionLabel } from "@/lib/practice/exam-page-regions";
import type {
  ExamDifficulty,
  ExamQuestion,
  ExamQuestionProvenance,
} from "@/lib/practice/exam-questions";

/**
 * A numbered question with all of its parts, which is what a session serves.
 *
 * Parts are stored, marked and answered one at a time, and they used to be
 * drawn that way too -- so a session could hand a student 26(c) with no 26(a)
 * or 26(b) anywhere in it, or 14(b) before 14(a). The crop carries the stem,
 * but not what the earlier parts established or what the student answered for
 * them, and a paper's parts are written to be read in order.
 *
 * So a question is drawn whole, its parts kept together and in the order the
 * paper prints them. Each part is still its own answer and its own mark.
 */
export type ExamQuestionGroup<Part> = {
  key: string;
  /** The hardest of its parts: a question is as hard as the hardest thing it asks. */
  difficulty: ExamDifficulty;
  parts: Part[];
};

type GroupablePart = Pick<ExamQuestion, "id" | "paperId" | "difficulty" | "provenance">;

const DIFFICULTY_RANK: Record<ExamDifficulty, number> = { easy: 0, medium: 1, hard: 2 };

/** Which question a part belongs to: its paper and its root number. */
export function examQuestionGroupKey(part: Pick<ExamQuestion, "id" | "paperId" | "provenance">) {
  const root = rootQuestionLabel(part.provenance?.questionNumber ?? "");
  // A question with no readable number, or no paper, stands alone.
  return part.paperId && root ? `${part.paperId}#${root}` : `question#${part.id}`;
}

/**
 * Which question a part belongs to, read from a session rather than the bank.
 *
 * A session stores its parts projected, and the projection does not carry
 * `paperId` -- so `examQuestionGroupKey` cannot be used on one. Provenance
 * names the same paper in the board's own terms, and every session ever
 * written carries it, so grouping works on sessions that were started long
 * before anybody thought to group them.
 */
export function examSessionPartGroupKey(
  part: Pick<ExamQuestion, "id"> & { provenance?: Partial<ExamQuestionProvenance> }
) {
  const root = rootQuestionLabel(part.provenance?.questionNumber ?? "");
  const paper = [
    part.provenance?.board,
    part.provenance?.specificationId,
    part.provenance?.componentCode,
    part.provenance?.year,
    part.provenance?.series,
    part.provenance?.paperReference,
  ]
    .filter(Boolean)
    .join("|");
  return paper && root ? `${paper}#${root}` : `question#${part.id}`;
}

/** One numbered question inside a session: where its parts start, and how many. */
export type ExamSessionQuestionRun = {
  key: string;
  /** The number the paper prints, e.g. "3". Empty when the label cannot be read. */
  number: string;
  /** Index into the session's flat list of parts. */
  from: number;
  count: number;
};

/**
 * A session's parts read back as the questions they came from.
 *
 * A session asked for two questions and listed fourteen parts, so it counted
 * itself "1 of 14" -- a number the student never chose and could not place
 * against the two they did. The parts of a question are stored together and in
 * order, so consecutive parts sharing a question are one run: the session can
 * say "question 1 of 2, part (b) of 7" without changing what is stored, what
 * is answered, or what is marked.
 *
 * Runs, not a map, precisely because the order is the session's. A question
 * that somehow appeared twice in one session stays two runs rather than being
 * silently merged across the questions between them.
 */
export function examSessionQuestionRuns(
  parts: ReadonlyArray<Pick<ExamQuestion, "id"> & { provenance?: Partial<ExamQuestionProvenance> }>
): ExamSessionQuestionRun[] {
  const runs: ExamSessionQuestionRun[] = [];
  parts.forEach((part, index) => {
    const key = examSessionPartGroupKey(part);
    const open = runs[runs.length - 1];
    if (open && open.key === key) {
      open.count += 1;
      return;
    }
    runs.push({
      key,
      number: rootQuestionLabel(part.provenance?.questionNumber ?? "") ?? "",
      from: index,
      count: 1,
    });
  });
  return runs;
}

/**
 * What the paper calls this part on its own: "(b)", ".2", or nothing.
 *
 * The part of the printed label that is not the question number. A part that
 * is the whole question -- an unlettered question 5 -- has no suffix, which is
 * how the session knows not to call it "part" anything.
 */
export function examQuestionPartLabel(questionNumber: string) {
  const label = normaliseQuestionLabel(questionNumber ?? "");
  if (!label) return "";
  const root = rootQuestionLabel(questionNumber ?? "");
  return label.startsWith(root) ? label.slice(root.length) : "";
}

/** The run a part is in, and where in it. Never out of range for a part in the list. */
export function examSessionRunAt(runs: readonly ExamSessionQuestionRun[], index: number) {
  const position = runs.findIndex((run) => index >= run.from && index < run.from + run.count);
  const runIndex = position < 0 ? 0 : position;
  const run = runs[runIndex];
  return {
    run,
    runIndex,
    /** 0 when there is no run, which only happens for an empty session. */
    partIndex: run ? index - run.from : 0,
  };
}

/** The order the paper prints them in: 14 before 14(a), 1.2 before 1.10. */
export function orderExamQuestionParts<Part extends Pick<ExamQuestion, "id" | "provenance">>(
  parts: readonly Part[]
): Part[] {
  const label = (part: Part) => {
    const raw = part.provenance?.questionNumber ?? "";
    return normaliseQuestionLabel(raw) ?? raw;
  };
  return [...parts].sort(
    (left, right) =>
      label(left).localeCompare(label(right), undefined, { numeric: true }) ||
      left.id.localeCompare(right.id)
  );
}

/**
 * Whether a question's parts are all present: (a), (b), (c) with none missing.
 *
 * Holding a question back when one of its stored parts cannot be served only
 * covers parts that were stored. A part extraction dropped, or one never
 * written, leaves nothing to hold the question back -- and 14(b) would then be
 * served as though it were the whole of question 14. So the letters present
 * have to run from (a) without a gap, and AQA's numbered parts from .1.
 *
 * Labels this cannot read are not held against the question: there is nothing
 * to compare them with, and refusing them would drop questions for a format
 * rather than for a missing part.
 */
export function examQuestionIsComplete(parts: ReadonlyArray<Pick<ExamQuestion, "provenance">>) {
  const letters = new Set<number>();
  const numbers = new Set<number>();
  for (const part of parts) {
    const label = normaliseQuestionLabel(part.provenance?.questionNumber ?? "");
    const letter = label?.match(/\(([a-z])\)$/);
    const number = label?.match(/\.(\d+)$/);
    if (letter) letters.add(letter[1].charCodeAt(0) - "a".charCodeAt(0) + 1);
    if (number) numbers.add(Number(number[1]));
  }
  const runsFromOne = (present: Set<number>) =>
    present.size === 0 || [...present].every((value) => value >= 1 && value <= present.size);
  return runsFromOne(letters) && runsFromOne(numbers);
}

export function hardestExamDifficulty(difficulties: readonly ExamDifficulty[]): ExamDifficulty {
  return difficulties.reduce<ExamDifficulty>(
    (hardest, difficulty) => (DIFFICULTY_RANK[difficulty] > DIFFICULTY_RANK[hardest] ? difficulty : hardest),
    "easy"
  );
}

/** Parts gathered into their questions, in the order each question was first met. */
export function groupExamQuestions<Part extends GroupablePart>(parts: readonly Part[]): ExamQuestionGroup<Part>[] {
  const byKey = new Map<string, Part[]>();
  for (const part of parts) {
    const key = examQuestionGroupKey(part);
    byKey.set(key, [...(byKey.get(key) ?? []), part]);
  }
  return [...byKey].map(([key, members]) => ({
    key,
    difficulty: hardestExamDifficulty(members.map((member) => member.difficulty)),
    parts: orderExamQuestionParts(members),
  }));
}

/**
 * Whole questions for a session, unseen ones first.
 *
 * A question counts as seen if any of its parts was: serving 14 again because
 * only 14(b) had been answered would still be a repeat to the student.
 */
export function chooseExamQuestionGroups<Part extends Pick<ExamQuestion, "id">>(
  groups: readonly ExamQuestionGroup<Part>[],
  wanted: number,
  seenIds: ReadonlySet<string>
): ExamQuestionGroup<Part>[] {
  const seen = (group: ExamQuestionGroup<Part>) => group.parts.some((part) => seenIds.has(part.id));
  return [...groups.filter((group) => !seen(group)), ...groups.filter(seen)].slice(0, Math.max(0, wanted));
}
