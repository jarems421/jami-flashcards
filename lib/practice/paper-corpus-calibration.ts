import { EXAM_BOARD_LABELS, isExamBoardId } from "@/lib/practice/exam-formats";
import { servableExamSpecificationTopics } from "@/lib/practice/exam-specification-topics";

/**
 * What real past papers for a course look like, as guidance for writing a new one.
 *
 * A generated paper already follows a format profile -- its duration, marks
 * and sections. What a profile cannot say is how the board actually writes:
 * how many one-mark items a paper opens with, how often a question is split
 * into parts, which command words start them, how the marks fall across
 * topics. The corpus holds reviewed, spot-checked questions for some courses,
 * so for those the generator is shown the pattern.
 *
 * Only aggregate figures are used. A licensed question's wording never reaches
 * the generator from here, and the guidance tells it to write originals.
 */

export type CalibrationQuestion = {
  paperId: string;
  componentCode: string;
  questionNumber: string;
  prompt: string;
  marks: number;
  topicIds: readonly string[];
  difficulty: "easy" | "medium" | "hard";
};

/** Stored on a generated paper, so a student can see what it was matched to. */
export type PracticePaperCorpusCalibration = {
  version: 1;
  board: string;
  boardLabel: string;
  specificationId: string;
  specificationTitle: string;
  components: string[];
  papers: number;
  questions: number;
};

/** Fewer reviewed questions than this is an anecdote, not a pattern. */
export const MIN_CALIBRATION_QUESTIONS = 20;

const COMMAND_WORDS = [
  "Work out",
  "Calculate",
  "Show that",
  "Explain",
  "Describe",
  "Evaluate",
  "Give",
  "State",
  "Name",
  "Suggest",
  "Compare",
  "Complete",
  "Draw",
  "Plot",
  "Estimate",
  "Simplify",
  "Solve",
  "Factorise",
  "Expand",
  "Prove",
  "Write down",
  "Determine",
  "Justify",
  "Identify",
  "Sketch",
  "Find",
] as const;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Command words that open a sentence of the prompt, each counted once per question.
 *
 * "Give your answer to 2 decimal places" is an instruction about the answer,
 * not what the question asks for, and it closes a large share of maths
 * questions -- counted, it put "Give" second only to "Work out".
 */
export function openingCommandWords(prompt: string): string[] {
  const text = prompt.trim().replace(/(?:^|[.!?\n]\s*)give your answers?\b[^.!?\n]*/gi, " ");
  return COMMAND_WORDS.filter((word) =>
    new RegExp(`(?:^|[.!?\\n]\\s*)${escapeRegExp(word)}\\b`, "i").test(text.trim())
  );
}

/**
 * A course title without the board and code a catalogue title often repeats.
 *
 * "Pearson Edexcel Level 1/Level 2 GCSE in Mathematics (1MA1)" printed after
 * the board label and before the code read "Pearson Edexcel Pearson Edexcel
 * ... (1MA1) (1MA1)".
 */
export function plainCourseTitle(title: string, boardLabel: string, specificationId: string) {
  const withoutBoard = title.trim().replace(new RegExp(`^${escapeRegExp(boardLabel)}\\s+`, "i"), "");
  const withoutCode = withoutBoard.replace(new RegExp(`\\s*\\(${escapeRegExp(specificationId)}\\)$`, "i"), "");
  return withoutCode.trim() || title.trim();
}

const percent = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

export function buildPaperCorpusCalibration(input: {
  board: string;
  boardLabel?: string;
  specificationId: string;
  specificationTitle: string;
  questions: readonly CalibrationQuestion[];
}): { record: PracticePaperCorpusCalibration; context: string } | null {
  const questions = input.questions.filter((question) => question.marks > 0 && question.prompt.trim());
  if (questions.length < MIN_CALIBRATION_QUESTIONS) return null;

  const papers = new Set(questions.map((question) => question.paperId));
  const components = [...new Set(questions.map((question) => question.componentCode).filter(Boolean))].sort();
  const boardLabel =
    input.boardLabel || (isExamBoardId(input.board) ? EXAM_BOARD_LABELS[input.board] : input.board);
  const specificationTitle = plainCourseTitle(input.specificationTitle, boardLabel, input.specificationId);
  const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0);

  const tariffBands = ["1", "2", "3", "4", "5", "6+"].map((band, index) => {
    const count = questions.filter((question) =>
      index === 5 ? question.marks >= 6 : question.marks === index + 1
    ).length;
    return `${band} mark${band === "1" ? "" : "s"} ${percent(count, questions.length)}%`;
  });

  const parts = questions.filter((question) => /[.(]/.test(question.questionNumber)).length;

  const commandCounts = new Map<string, number>();
  for (const question of questions) {
    for (const word of openingCommandWords(question.prompt)) {
      commandCounts.set(word, (commandCounts.get(word) ?? 0) + 1);
    }
  }
  const commands = [...commandCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => `${word} ${percent(count, questions.length)}%`);

  const catalogue = servableExamSpecificationTopics(input.specificationId);
  const topicLabels = new Map(catalogue?.topics.map((topic) => [topic.id, topic.label]) ?? []);
  const topicMarks = new Map<string, number>();
  for (const question of questions) {
    const labels = question.topicIds.map((id) => topicLabels.get(id)).filter((label): label is string => Boolean(label));
    // A question on two topics lends its marks to both halves, so neither is overstated.
    for (const label of labels) {
      topicMarks.set(label, (topicMarks.get(label) ?? 0) + question.marks / labels.length);
    }
  }
  const topics = [...topicMarks.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, marks]) => `${label} ${percent(marks, totalMarks)}%`);

  const difficulty = (["easy", "medium", "hard"] as const)
    .map((level) => `${level} ${percent(questions.filter((question) => question.difficulty === level).length, questions.length)}%`);

  const record: PracticePaperCorpusCalibration = {
    version: 1,
    board: input.board,
    boardLabel,
    specificationId: input.specificationId,
    specificationTitle,
    components,
    papers: papers.size,
    questions: questions.length,
  };

  const context = [
    `Calibration from real past papers: ${papers.size} reviewed ${boardLabel} ${specificationTitle} (${input.specificationId}) paper${papers.size === 1 ? "" : "s"}${components.length ? ` [${components.join(", ")}]` : ""}, ${questions.length} questions and parts.`,
    // Numbered questions and parts said apart: "31 questions and parts" read as
    // a question count, above the 30 a practice paper may hold.
    `A real paper averages ${Math.round(new Set(questions.map((question) => `${question.paperId}:${question.questionNumber.match(/^0*(\d{1,2})/)?.[1] ?? question.questionNumber}`)).size / papers.size)} numbered questions (${Math.round(questions.length / papers.size)} items counting their parts) worth ${Math.round(totalMarks / papers.size)} marks in total.`,
    `Marks per question or part: ${tariffBands.join(", ")}.`,
    `${percent(parts, questions.length)}% of items are numbered or lettered parts of a larger question.`,
    commands.length ? `Command words opening questions, by share of items: ${commands.join(", ")}.` : "",
    topics.length ? `Topic balance by marks: ${topics.join(", ")}.` : "",
    `Difficulty mix: ${difficulty.join(", ")}.`,
    "Use this only to match the real papers' style, tariff spread, part structure and balance. A supplied format profile still controls the exact duration, marks and sections. Write entirely original questions: never reuse, adapt or paraphrase a real past-paper question, its context, data or diagram.",
  ].filter(Boolean).join("\n");

  return { record, context };
}

export function normalizePracticePaperCorpusCalibration(value: unknown): PracticePaperCorpusCalibration | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  const text = (entry: unknown, max: number) => (typeof entry === "string" ? entry.trim().slice(0, max) : "");
  const count = (entry: unknown) =>
    typeof entry === "number" && Number.isFinite(entry) && entry > 0 ? Math.round(entry) : 0;
  const board = text(data.board, 40);
  const specificationId = text(data.specificationId, 40);
  const papers = count(data.papers);
  const questions = count(data.questions);
  if (data.version !== 1 || !board || !specificationId || papers < 1 || questions < 1) return undefined;
  return {
    version: 1,
    board,
    boardLabel: text(data.boardLabel, 80) || board,
    specificationId,
    specificationTitle: text(data.specificationTitle, 160) || specificationId,
    components: (Array.isArray(data.components) ? data.components : [])
      .map((component) => text(component, 40))
      .filter(Boolean)
      .slice(0, 20),
    papers,
    questions,
  };
}
