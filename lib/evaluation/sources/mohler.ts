import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";

/**
 * Parser for `mohler` — the UNT computer science short answer dataset.
 *
 * Undergraduate answers to introductory computer science questions, each graded
 * independently by two people: the class TA and one of the dataset's authors.
 *
 * Both graders are kept. The dataset ships their average in `scores/x.y/ave`
 * and it is never read, because the average is the one number that cannot say
 * how far apart the two humans were — which is the whole reason this source is
 * valuable. Two graders on 2,000-odd answers is the largest disagreement
 * measurement available anywhere in the corpus.
 *
 * Two traps in the layout, both called out by the dataset's own README.
 *
 * Assignments 11 and 12 were graded out of ten, not five. Only the averaged
 * file was normalised; the per-grader files this parser reads are raw, so those
 * questions carry a maximum of ten. Rescaling them to match the rest would
 * invent precision the graders never expressed.
 *
 * Question ids commented out with a leading `#` in `docs/files` are excluded,
 * as they are in the authors' own published work: they are selection and
 * ordering questions rather than short answers, so there is no prose to mark.
 */

const DEFAULT_MAX_MARKS = 5;
const TEN_POINT_ASSIGNMENTS = new Set(["11", "12"]);

export type MohlerQuestionFiles = {
  /** `data/raw/x.y` — one student answer per line. */
  answers: string;
  /** `data/scores/x.y/other` — the class TA. */
  taScores: string;
  /** `data/scores/x.y/me` — the dataset author. */
  authorScores: string;
};

export type MohlerInput = {
  /** `data/docs/files` */
  fileList: string;
  /** `data/raw/questions` */
  questions: string;
  /** `data/raw/answers` — the instructor's reference answers. */
  referenceAnswers: string;
  /** Per question id, the three aligned files. */
  items: Record<string, MohlerQuestionFiles>;
};

export type MohlerResult = {
  records: MarkingCorpusRecord[];
  issues: string[];
  stats: {
    questionsListed: number;
    questionsIngested: number;
    /** Questions the authors themselves exclude as not short-answer. */
    excludedByAuthors: number;
    ingested: number;
    gradersDisagreed: number;
    widestDisagreement: number;
    tenPointQuestions: number;
    misalignedQuestions: number;
    outOfRange: number;
    emptyAnswer: number;
  };
};

const lines = (text: string) => text.split(/\r?\n/).filter((line) => line.trim() !== "");

/** `1.1 some text` -> `some text`, and drop the transport markup in the raw files. */
function stripId(line: string, questionId?: string) {
  const withoutId = questionId
    ? line.replace(new RegExp(`^${questionId.replace(".", "\\.")}\\s+`), "")
    : line.replace(/^\d+\.\d+\s+/, "");
  return withoutId.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
}

/** Keyed by question id, from the `x.y text` files. */
function readKeyed(text: string) {
  const byId = new Map<string, string>();
  for (const line of lines(text)) {
    const match = /^(\d+\.\d+)\s+(.*)$/.exec(line.trim());
    if (match) byId.set(match[1], stripId(match[2]));
  }
  return byId;
}

/** Marks out of ten for assignments 11 and 12; out of five everywhere else. */
export function maxMarksFor(questionId: string) {
  return TEN_POINT_ASSIGNMENTS.has(questionId.split(".")[0]) ? 10 : DEFAULT_MAX_MARKS;
}

export function parseMohler(input: MohlerInput): MohlerResult {
  const records: MarkingCorpusRecord[] = [];
  const issues: string[] = [];
  const prompts = readKeyed(input.questions);
  const references = readKeyed(input.referenceAnswers);

  const listed = lines(input.fileList).map((line) => line.trim());
  const excluded = listed.filter((line) => line.startsWith("#"));
  const wanted = listed.filter((line) => !line.startsWith("#"));

  let questionsIngested = 0;
  let gradersDisagreed = 0;
  let widestDisagreement = 0;
  let tenPointQuestions = 0;
  let misalignedQuestions = 0;
  let outOfRange = 0;
  let emptyAnswer = 0;

  for (const questionId of wanted) {
    const files = input.items[questionId];
    if (!files) {
      issues.push(`${questionId}: listed in docs/files but its data is missing; skipped.`);
      continue;
    }

    const answers = lines(files.answers).map((line) => stripId(line, questionId));
    const taScores = lines(files.taScores);
    const authorScores = lines(files.authorScores);

    // The three files are parallel: line n of each describes the same answer.
    // If they are not the same length that correspondence is broken, and a mark
    // would be attached to somebody else's answer.
    if (answers.length !== taScores.length || answers.length !== authorScores.length) {
      misalignedQuestions += 1;
      issues.push(
        `${questionId}: ${answers.length} answers against ${taScores.length} and ${authorScores.length} grades; the files do not line up, so the whole question is skipped.`
      );
      continue;
    }

    const maxMarks = maxMarksFor(questionId);
    if (maxMarks !== DEFAULT_MAX_MARKS) tenPointQuestions += 1;
    questionsIngested += 1;

    for (const [index, answer] of answers.entries()) {
      if (!answer) {
        emptyAnswer += 1;
        continue;
      }

      const marks = [Number(taScores[index]), Number(authorScores[index])];
      if (marks.some((mark) => !Number.isFinite(mark))) {
        issues.push(`${questionId}.${index}: unreadable grade; skipped.`);
        continue;
      }
      const beyond = marks.filter((mark) => mark < 0 || mark > maxMarks);
      if (beyond.length > 0) {
        outOfRange += 1;
        issues.push(`${questionId}.${index}: grade ${beyond.join(" and ")} outside 0..${maxMarks}; skipped.`);
        continue;
      }

      const spread = Math.max(...marks) - Math.min(...marks);
      if (spread > 0) gradersDisagreed += 1;
      widestDisagreement = Math.max(widestDisagreement, spread);

      records.push({
        id: `mohler:${questionId}.${index}`,
        sourceId: "mohler",
        level: "undergraduate",
        subject: "computerScience",
        // Graded for correctness as a whole against the instructor's answer,
        // rather than by counting off a pool of creditable points.
        regime: "banded",
        questionId,
        questionPrompt: prompts.get(questionId) ?? "",
        answer: { kind: "text", text: answer },
        humanMarks: marks,
        maxMarks,
        ...(references.get(questionId) ? { markScheme: references.get(questionId)! } : {}),
      });
    }

    if (!prompts.has(questionId)) issues.push(`${questionId}: no question text found.`);
    if (!references.has(questionId)) issues.push(`${questionId}: no instructor answer found.`);
  }

  return {
    records,
    issues,
    stats: {
      questionsListed: listed.length,
      questionsIngested,
      excludedByAuthors: excluded.length,
      ingested: records.length,
      gradersDisagreed,
      widestDisagreement,
      tenPointQuestions,
      misalignedQuestions,
      outOfRange,
      emptyAnswer,
    },
  };
}
