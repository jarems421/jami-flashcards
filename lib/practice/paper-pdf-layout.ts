import type {
  PracticePaperAssessmentProfile,
  PracticePaperQuestion,
} from "@/lib/practice/practice-papers";

/**
 * How a generated practice paper is laid out as a printed exam booklet.
 *
 * Generated papers used to open as one notebook page per question: the prompt
 * typed across the top of a blank page. It read as a list of questions rather
 * than a paper, and it gave a one-mark "name this" the same page as a six-mark
 * evaluation. A real paper leaves answer space in proportion to what the
 * question asks for, and these numbers come from real papers: the gap between
 * each printed tariff and the next thing on the page, measured across the
 * AQA and Pearson Edexcel GCSE papers in the exam corpus. Only the
 * measurements are kept here, never any board content.
 *
 * Everything is in PDF points: 72 to the inch, an A4 page 595 x 842.
 */

export const PAPER_PAGE_WIDTH = 595.28;
export const PAPER_PAGE_HEIGHT = 841.89;
/** AQA rules answer lines about 26pt apart; so do we. */
export const ANSWER_LINE_SPACING = 26;

export type PaperSubjectGroup = "maths" | "science" | "writing";
export type PaperQuestionKind = "choice" | "draw" | "calculation" | "extended" | "short";

const MATHS = /\b(math|maths|mathematics|statistics|further pure|mechanics)\b/i;
const SCIENCE = /\b(biology|chemistry|physics|science|trilogy|synergy)\b/i;

/** Which family of papers this one should be spaced like. */
export function paperSubjectGroup(
  profile: Partial<PracticePaperAssessmentProfile> | undefined,
  title = ""
): PaperSubjectGroup {
  const described = [
    title,
    profile?.qualificationOrModule,
    profile?.specificationOrCourse,
    profile?.tierOrComponent,
  ].filter(Boolean).join(" ");
  if (MATHS.test(described)) return "maths";
  if (SCIENCE.test(described)) return "science";
  return "writing";
}

/** What a question asks the student to produce, read from how it is worded. */
export function inferPaperQuestionKind(
  question: Pick<PracticePaperQuestion, "prompt" | "marks">
): PaperQuestionKind {
  const prompt = question.prompt.toLowerCase();
  if (/\btick (one|two|three) box|\bshade (one|two) circle|\bcircle the correct|\bwhich (?:one )?of (?:the following|these)\b/.test(prompt)) {
    return "choice";
  }
  if (/\b(draw|sketch|plot)\b|\bcomplete (the )?(table|graph|diagram|figure|chart)\b|\bon the grid\b|\blabel (the )?(diagram|figure)\b/.test(prompt)) {
    return "draw";
  }
  if (/\b(calculate|work out|show that|solve|simplify|expand|factorise|factorize)\b|\bgive your answer to\b|\bfind the value\b|\bdetermine the value\b/.test(prompt)) {
    return "calculation";
  }
  if (question.marks >= 6 || (question.marks >= 4 && /\b(explain|describe|evaluate|compare|discuss|analyse|analyze|assess|justify|suggest)\b|\bto what extent\b/.test(prompt))) {
    return "extended";
  }
  return "short";
}

/**
 * The space to leave under a question, in points.
 *
 * Measured medians, per mark, from the corpus:
 * - science calculations: 77, 103, 154, 206, 257 and 331pt for 1 to 6 marks,
 *   about 51pt a mark on top of an answer line;
 * - extended science writing: 269pt at 4 marks and 404pt at 6, about 67pt a mark;
 * - maths working: 95, 149, 226 and 360pt for 1 to 4 marks, room for working
 *   rather than lines;
 * - a question answered on its figure, or by ticking a box, leaves almost
 *   none, because the answer goes where the figure or the boxes already are.
 *
 * Short written answers take an answer line plus two a mark, which sits on the
 * calculation figures and matches how AQA rules them.
 */
export function answerSpacePoints(
  question: Pick<PracticePaperQuestion, "prompt" | "marks">,
  group: PaperSubjectGroup
): number {
  const marks = Math.max(1, Math.round(question.marks) || 1);
  const kind = inferPaperQuestionKind(question);
  if (kind === "choice") return ANSWER_LINE_SPACING;
  if (kind === "draw") return ANSWER_LINE_SPACING * 2;
  if (group === "maths") return 30 + 75 * marks;
  if (kind === "calculation") return 26 + 51 * marks;
  if (kind === "extended") return Math.min(67 * marks, EXTENDED_ANSWER_MAX);
  return ANSWER_LINE_SPACING * (1 + 2 * marks);
}

/**
 * The most answer space any one written answer gets: about four pages of lines.
 *
 * The per-mark rate was measured on science answers up to six marks and does
 * not hold for an essay. An 87-mark writing task asking for 400 to 600 words
 * was given eight pages of lines, most of a booklet, where an exam answer
 * booklet gives an essay about four.
 */
export const EXTENDED_ANSWER_MAX = 2_800;

/** How many ruled lines fill a given space. Maths working space is left blank. */
export function answerLineCount(points: number) {
  return Math.max(1, Math.floor(points / ANSWER_LINE_SPACING));
}

/**
 * Which questions are printed on each page of a generated paper's PDF.
 *
 * Written by the server when it lays the paper out, so marking knows which
 * question the work on a page belongs to rather than guessing, as it has to
 * for a paper the student uploaded.
 */
export type PracticePaperPdfLayout = {
  version: 1;
  fileId: string;
  pageCount: number;
  pages: Array<{ pageIndex: number; questionIds: string[] }>;
};

const MAX_LAYOUT_PAGES = 200;
const MAX_QUESTIONS_PER_PAGE = 30;

export function normalizePracticePaperPdfLayout(value: unknown): PracticePaperPdfLayout | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  const fileId = typeof data.fileId === "string" ? data.fileId.trim().slice(0, 160) : "";
  const pageCount = typeof data.pageCount === "number" && Number.isFinite(data.pageCount)
    ? Math.round(data.pageCount)
    : 0;
  if (data.version !== 1 || !fileId || pageCount < 1 || pageCount > MAX_LAYOUT_PAGES) return undefined;
  const pages = (Array.isArray(data.pages) ? data.pages : []).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const page = entry as Record<string, unknown>;
    const pageIndex = typeof page.pageIndex === "number" ? Math.round(page.pageIndex) : -1;
    if (pageIndex < 0 || pageIndex >= pageCount) return [];
    const questionIds = (Array.isArray(page.questionIds) ? page.questionIds : [])
      .flatMap((id) => (typeof id === "string" && id.trim() ? [id.trim().slice(0, 160)] : []))
      .slice(0, MAX_QUESTIONS_PER_PAGE);
    return [{ pageIndex, questionIds }];
  });
  return { version: 1, fileId, pageCount, pages };
}

/** The questions on one notebook page, when that page is a page of the paper's own PDF. */
export function questionIdsForPdfPage(
  layout: PracticePaperPdfLayout | undefined,
  page: { backgroundFileId?: string; pdfPageIndex?: number },
  knownQuestionIds: ReadonlySet<string>
): string[] {
  if (!layout || page.backgroundFileId !== layout.fileId) return [];
  const entry = layout.pages.find((item) => item.pageIndex === (page.pdfPageIndex ?? 0));
  return (entry?.questionIds ?? []).filter((id) => knownQuestionIds.has(id));
}

/** The rows of a Markdown table, without its alignment row. */
export function parseMarkdownTableRows(content: string): string[][] {
  return content
    .split("\n")
    .map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((row) => row.length > 1 && !row.every((cell) => /^:?-+:?$/.test(cell)));
}
