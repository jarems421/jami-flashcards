import type { ExamSheetPage } from "@/lib/practice/exam-question-sheet";
import { getNotebookPaperPalette } from "@/lib/workspace/notebook-paper-palette";
import type { NotebookPageColor, NotebookPageStyle } from "@/lib/workspace/notebooks";

/**
 * The paper a student's own sheets are made of.
 *
 * The board's pages are the board's: a printed page is a picture of the paper
 * as it was printed, and recolouring or re-ruling it would be altering the
 * question. The sheets behind it are not the board's, they are the student's,
 * and there is no reason those should be ruled lines on white because that is
 * what the pad that came before them happened to be. Squared paper is the
 * difference between doing and not doing a graph; cream is the difference
 * between reading comfortably and not, for a good number of people.
 *
 * So the choice reaches exactly as far as it should: continuation sheets take
 * it, printed pages never do.
 *
 * It is the notebook's own vocabulary -- the same four rulings, the same three
 * papers, the same picker -- because a student who has set up their notebook
 * the way they like should not have to learn a second set of words for paper
 * the moment the work is going to be marked.
 */

export type ExamSheetPaper = {
  pageColor: NotebookPageColor;
  pageStyle: NotebookPageStyle;
};

/**
 * Ruled white, which is what every sheet was before this was a choice.
 *
 * A default is not a recommendation. It is what a student who never opens the
 * picker gets, and that should be the thing they already had.
 */
export const EXAM_SHEET_PAPER_DEFAULT: ExamSheetPaper = {
  pageColor: "white",
  pageStyle: "lined",
};

const STORAGE_KEY = "jami.practice.sheetPaper";

const PAGE_COLORS: readonly NotebookPageColor[] = ["white", "cream", "black"];
const PAGE_STYLES: readonly NotebookPageStyle[] = ["plain", "lined", "grid", "dot"];

export function isExamSheetPaper(value: unknown): value is ExamSheetPaper {
  if (!value || typeof value !== "object") return false;
  const paper = value as Partial<ExamSheetPaper>;
  return (
    PAGE_COLORS.includes(paper.pageColor as NotebookPageColor) &&
    PAGE_STYLES.includes(paper.pageStyle as NotebookPageStyle)
  );
}

export function readExamSheetPaperPreference(): ExamSheetPaper {
  if (typeof window === "undefined") return EXAM_SHEET_PAPER_DEFAULT;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return EXAM_SHEET_PAPER_DEFAULT;
    const parsed: unknown = JSON.parse(stored);
    return isExamSheetPaper(parsed) ? parsed : EXAM_SHEET_PAPER_DEFAULT;
  } catch {
    // Storage can be unavailable in privacy modes; the default stands.
    return EXAM_SHEET_PAPER_DEFAULT;
  }
}

export function saveExamSheetPaperPreference(paper: ExamSheetPaper) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(paper));
  } catch {
    // A preference that cannot be stored is still honoured for this sheet.
  }
}

/**
 * What a page is flattened onto in the image the marker reads.
 *
 * This is the reason the choice can be offered at all. Ink is drawn in the
 * colour the student picked and nothing adjusts it to the paper, so a light
 * pen on a dark page is a perfectly ordinary thing to write -- and flattening
 * that onto white, which is what every page used to be flattened onto, would
 * have handed the marker a blank sheet and called it the student's answer.
 *
 * Flattening each page onto its own ground makes that impossible rather than
 * unlikely: what is submitted is what was on the screen. A printed page is
 * white because the paper is white.
 */
export function examSheetPageGround(
  page: Pick<ExamSheetPage, "kind">,
  paper: ExamSheetPaper
): string {
  return page.kind === "printed" ? "#ffffff" : getNotebookPaperPalette(paper.pageColor).paper;
}
