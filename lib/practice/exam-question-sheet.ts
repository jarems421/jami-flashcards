import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";
import { getNotebookViewportInset } from "@/lib/workspace/notebook-viewport";

/**
 * A question as a sheet of paper to write on, rather than a picture beside a
 * blank pad.
 *
 * Ingestion renders a question's own slice of the paper twice: once stitched
 * into the single `question-extract` image, which is what the marker and the
 * older layouts read, and once as one image per page of the paper. This module
 * is about the second kind. A page image is the board's own typesetting --
 * its wording, its diagrams, its ruled answer lines -- at the size and shape
 * the board printed it, so a student can write in the space the question was
 * designed to be answered in.
 *
 * The sheet is printed pages followed by continuation pages. A continuation
 * page is Jami's own blank ruled sheet, never a rendering of the paper: the
 * board's blank answer pages are counted at ingestion (`answerSpacePagesAfter`)
 * and handed back as that many continuation sheets, so nothing blank and
 * licensed is ever stored or served.
 */

/** The id ingestion gives each page of a question's own crop, from 1. */
export const EXAM_SHEET_PAGE_ASSET_PREFIX = "question-page-";

export function examSheetPageAssetId(index: number) {
  return `${EXAM_SHEET_PAGE_ASSET_PREFIX}${index + 1}`;
}

/** Written out rather than built from the prefix, so it stays greppable. */
const PAGE_ASSET_PATTERN = /^question-page-(\d{1,2})$/;

export function examSheetPageAssetNumber(id: string): number | null {
  const match = PAGE_ASSET_PATTERN.exec(id);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 && number <= EXAM_SHEET_MAX_PRINTED_PAGES ? number : null;
}

/**
 * The printed pages of a question, in the order the paper prints them.
 *
 * Sorted by the number in the id rather than by array order: the assets come
 * back from Firestore as stored, and `question-page-10` sorts before
 * `question-page-2` in any string comparison.
 */
export function examSheetPrintedPages(question: {
  assets: PracticePaperQuestionAsset[];
}): PracticePaperQuestionAsset[] {
  return question.assets
    .flatMap((asset) => {
      const number = examSheetPageAssetNumber(asset.id);
      if (number === null || asset.type !== "image") return [];
      if (!asset.width || !asset.height) return [];
      return [{ number, asset }];
    })
    .sort((left, right) => left.number - right.number)
    .map((entry) => entry.asset);
}

/**
 * The sheet's own coordinate width. Every page is drawn at this width and
 * keeps its own printed proportions, so a crop that is half a page tall stays
 * half a page tall.
 */
export const EXAM_SHEET_PAGE_WIDTH = 900;

/** A4, which is what every board prints on. */
export const EXAM_SHEET_A4_PAGE_HEIGHT = Math.round((EXAM_SHEET_PAGE_WIDTH * 297) / 210);

/**
 * A crop shorter than this is a stub -- the last two lines of a question that
 * ran over -- and is still a page worth writing on, but never one worth
 * opening the sheet on.
 */
export const EXAM_SHEET_MIN_PAGE_HEIGHT = 120;

/** Ingestion never writes more page images than this for one question. */
export const EXAM_SHEET_MAX_PRINTED_PAGES = 12;

/**
 * Continuation pages a student may add beyond the board's own allowance.
 *
 * The real paper's answer is the extra answer booklet at the back, and this is
 * the same offer: a student who needs more room takes more, without having to
 * decide in advance how much of the page each part deserves. The bound is
 * there so a sheet cannot grow past what can be read at marking.
 */
export const EXAM_SHEET_MAX_CONTINUATION_PAGES = 8;

/** Printed and continuation pages together, whatever the mix. */
export const EXAM_SHEET_MAX_PAGES = 16;

export type ExamSheetPage =
  | {
      kind: "printed";
      /** 1-based, as the question's own crop is paginated. */
      number: number;
      assetId: string;
      width: number;
      height: number;
    }
  | {
      kind: "continuation";
      /** 1-based among continuation pages only. */
      number: number;
      width: number;
      height: number;
    };

/** A printed page at the sheet's width, keeping the crop's own proportions. */
function printedPage(asset: PracticePaperQuestionAsset, number: number): ExamSheetPage {
  const height = Math.max(
    EXAM_SHEET_MIN_PAGE_HEIGHT,
    Math.round((EXAM_SHEET_PAGE_WIDTH * (asset.height ?? 1)) / (asset.width ?? 1))
  );
  return {
    kind: "printed",
    number,
    assetId: asset.id,
    width: EXAM_SHEET_PAGE_WIDTH,
    height,
  };
}

function continuationPage(number: number): ExamSheetPage {
  return {
    kind: "continuation",
    number,
    width: EXAM_SHEET_PAGE_WIDTH,
    height: EXAM_SHEET_A4_PAGE_HEIGHT,
  };
}

/**
 * How many blank pages the sheet opens with.
 *
 * Only ever the room the board itself left and the crop then dropped. A
 * mid-paper question scores zero here and needs nothing: its answer space sits
 * between its own label and the next question's, so the crop already carries
 * every ruled line the board printed for it. It is the last question on a
 * paper whose space goes missing, and for AQA English Language that is six
 * pages of an essay's worth.
 *
 * A question with no printed page at all -- one Jami wrote -- has no allotted
 * space to restore, so it opens on a single blank sheet, which is what the pad
 * that came before this was.
 */
export function examSheetOpeningContinuations(input: {
  answerSpacePages?: number;
  printedPageCount: number;
}): number {
  if (input.printedPageCount === 0) return 1;
  const allotted = Math.round(input.answerSpacePages ?? 0);
  if (!Number.isFinite(allotted) || allotted <= 0) return 0;
  return Math.min(allotted, EXAM_SHEET_MAX_CONTINUATION_PAGES, examSheetContinuationRoom(input.printedPageCount));
}

/** Continuation pages that still fit beside the printed ones. */
export function examSheetContinuationRoom(printedPageCount: number) {
  return Math.max(0, Math.min(EXAM_SHEET_MAX_CONTINUATION_PAGES, EXAM_SHEET_MAX_PAGES - printedPageCount));
}

/**
 * The pages of one question's sheet: what is printed, then room to carry on.
 */
export function examSheetPages(input: {
  printedPages: readonly PracticePaperQuestionAsset[];
  continuationCount: number;
}): ExamSheetPage[] {
  const printed = input.printedPages
    .slice(0, EXAM_SHEET_MAX_PRINTED_PAGES)
    .map((asset, index) => printedPage(asset, index + 1));
  const room = examSheetContinuationRoom(printed.length);
  const extra = Math.max(printed.length === 0 ? 1 : 0, Math.min(room, Math.round(input.continuationCount)));
  return [...printed, ...Array.from({ length: extra }, (_unused, index) => continuationPage(index + 1))];
}

/**
 * What one page of working is, said in a line, for the band drawn above it in
 * the image the marker reads.
 *
 * The marker is sent the question's printed pages as question material and the
 * student's ink on white as their answer, so nothing in front of it says which
 * ink was written where. Naming each page does: working on the third printed
 * page of a question is working on that part of it, and working on an extra
 * sheet is an answer that ran past the room the paper left.
 */
export function examSheetPageCaption(input: {
  page: Pick<ExamSheetPage, "kind" | "number">;
  questionLabel: string;
  printedPageCount: number;
}) {
  const label = input.questionLabel.trim() || "this question";
  if (input.page.kind === "continuation") {
    // A Jami-created question has no printed page, so its sheet is where the whole answer is, not an overflow from one.
    return input.printedPageCount === 0
      ? `${label} — answer sheet ${input.page.number}`
      : `${label} — extra answer sheet ${input.page.number}`;
  }
  return input.printedPageCount > 1
    ? `${label} — written on printed page ${input.page.number} of ${input.printedPageCount}`
    : `${label} — written on the printed page`;
}

/**
 * A stored sheet, laid back down the way it was written.
 *
 * A page's position on the sheet is what says where its ink was written, so
 * the stored pages go back at the index they were saved at rather than packed
 * to the front. Saving drops blank pages off the end, so a sheet reopens with
 * the board's own allowance again, or with however many pages the student had
 * written on -- whichever is more.
 */
export function examSheetReopening(input: {
  stored: readonly string[];
  printedPages: readonly PracticePaperQuestionAsset[];
  answerSpacePages?: number;
}): { continuationCount: number; pages: string[] } {
  const printedPageCount = input.printedPages.length;
  const opening = examSheetOpeningContinuations({
    answerSpacePages: input.answerSpacePages,
    printedPageCount,
  });
  const written = Math.max(0, input.stored.length - printedPageCount);
  const continuationCount = Math.min(
    Math.max(opening, written),
    examSheetContinuationRoom(printedPageCount)
  );
  const sheet = examSheetPages({ printedPages: input.printedPages, continuationCount });
  return {
    continuationCount,
    pages: Array.from({ length: sheet.length }, (_unused, index) => input.stored[index] ?? ""),
  };
}

/** The page whose shape needs the most height for its width. */
export function examSheetTallestPage(pages: readonly ExamSheetPage[]): ExamSheetPage {
  return pages.reduce(
    (tallest, page) => (page.height / page.width > tallest.height / tallest.width ? page : tallest),
    pages[0] ?? continuationPage(1)
  );
}

/**
 * How tall a frame has to be for a page to fill its width, inline.
 *
 * Inline the sheet flows with the practice page: its width is the column's and
 * its height follows from the paper. The notebook's viewport maths works from
 * a frame, so the frame is sized to the page rather than the other way round,
 * with the notebook's own margin either side of it.
 *
 * The margin depends on whether the frame is wider than it is tall, which
 * depends on the margin, so it is settled in two steps: once from the width
 * alone, and once more from the height that gives.
 */
export function examSheetInlineFrameHeight(width: number, pageWidth: number, pageHeight: number) {
  if (width <= 0 || pageWidth <= 0 || pageHeight <= 0) return 0;
  const fitted = (inset: number) => (width - inset * 2) * (pageHeight / pageWidth) + inset * 2;
  const provisional = fitted(getNotebookViewportInset(width, 0));
  return Math.ceil(fitted(getNotebookViewportInset(width, provisional)));
}

/**
 * A sheet's corner, and how far its paper reaches past the page to round it.
 * Scaled with the page on screen, within a range that reads as paper rather
 * than as a card at any size.
 *
 * The reach is what keeps the print whole: a square corner sits inside a
 * rounded one of radius r only if it is set in by r(1 - 1/sqrt 2), a little
 * under a third of the radius.
 */
export function examSheetCorner(pageWidthOnScreen: number) {
  const radius = Math.max(6, Math.min(14, pageWidthOnScreen * 0.016));
  return { radius, bleed: Math.ceil(radius * 0.3) };
}
