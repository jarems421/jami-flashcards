/**
 * When Jami is given the handwriting of pages other than the one in front of
 * the student.
 *
 * Typed text from nearby pages is always in the page map -- it is cheap. The
 * handwriting is not: each page is a rendered image, and attaching six of them
 * to every question would multiply the size and cost of ordinary requests that
 * had no use for them. So this is off unless the request looks like one that
 * cannot be answered from the current page alone.
 *
 * The bias is backwards. Working continues onto a page, so what a student needs
 * read alongside "is this right?" is almost always what came before it; a page
 * ahead only matters when they have written the question out in advance. Both
 * are available, and the whole window is capped so a request can never grow
 * without bound.
 */

export const MAX_NEIGHBOUR_HANDWRITING_PAGES = 3;

export type NotebookNeighbourRequest = {
  /** Page numbers to render, nearest to the current page first. */
  pageNumbers: number[];
  /** Why they were asked for, for the log and for nothing else. */
  reason:
    | "continuation_phrase"
    | "marking_request"
    | "sparse_current_page"
    | "question_elsewhere";
};

/**
 * Asking for work to be judged, which is the case this exists for.
 *
 * A student starts a question at the bottom of one page and finishes it on the
 * next, then asks for it to be marked from the page they finished on. Marking
 * the second half alone is worse than useless -- it reports errors that are not
 * there, because the setup it is checking against is on the page before. So a
 * marking request always gets the page behind it, whether or not the student
 * thought to mention that the working carries over.
 */
const MARKING = new RegExp(
  [
    "mark (?:this|my|it)",
    "mark my work",
    "check (?:this|my|it|over)",
    "have i (?:got|done) (?:this|it|that)",
    "is (?:this|that|my working|my answer) (?:right|correct|ok)",
    "did i (?:get|do) (?:this|it|that)",
    "where did i go wrong",
    "what did i (?:get|do) wrong",
    "any mistakes",
    "grade (?:this|my)",
  ].join("|"),
  "i"
);

/**
 * Phrases that say the answer is not all on this page.
 *
 * Deliberately about *continuation* rather than about diagrams or working in
 * general: "check my working" is answerable from the page it is written on, and
 * "carried on from the last page" is not.
 */
const CONTINUATION = new RegExp(
  [
    "previous page",
    "last page",
    "page before",
    "earlier page",
    "other page",
    "next page",
    "page after",
    "carried on",
    "carry on",
    "continued",
    "continues",
    "continuing",
    "started (?:it|this|the working) (?:on|earlier)",
    "from before",
    "up to here",
    "so far",
    "rest of (?:my|the) working",
    "part [a-d]\\b",
  ].join("|"),
  "i"
);

export type NotebookNeighbourInput = {
  /** What the student just asked. */
  message: string;
  currentPageNumber: number;
  /** Page numbers that exist in this notebook, in any order. */
  availablePageNumbers: readonly number[];
  /** Whether the current page carries a question prompt of its own. */
  currentPageHasQuestion: boolean;
  /** Whether any earlier page carries one. */
  earlierPageHasQuestion: boolean;
  /** Roughly how much the student has written on the current page. */
  currentPageTextLength: number;
};

/**
 * Which neighbouring pages to render, or none at all.
 *
 * Returns pages nearest first so a caller that can only afford one still gets
 * the one most likely to matter.
 */
export function selectNeighbourHandwritingPages(
  input: NotebookNeighbourInput
): NotebookNeighbourRequest | null {
  const available = new Set(input.availablePageNumbers);
  const back = (count: number) =>
    Array.from({ length: count }, (_, index) => input.currentPageNumber - index - 1)
      .filter((pageNumber) => available.has(pageNumber));
  const forward = (count: number) =>
    Array.from({ length: count }, (_, index) => input.currentPageNumber + index + 1)
      .filter((pageNumber) => available.has(pageNumber));

  const asked = CONTINUATION.test(input.message);

  if (asked) {
    /*
     * The student said so. Take the full window, backwards first, because a
     * phrase like "continued" points behind far more often than ahead and the
     * cap has to be spent on the likelier direction.
     */
    const pageNumbers = [
      ...back(MAX_NEIGHBOUR_HANDWRITING_PAGES),
      ...forward(MAX_NEIGHBOUR_HANDWRITING_PAGES),
    ].slice(0, MAX_NEIGHBOUR_HANDWRITING_PAGES);
    return pageNumbers.length > 0
      ? { pageNumbers, reason: "continuation_phrase" }
      : null;
  }

  /*
   * Marking. The page behind, always, because whether the working carries over
   * is not something the student announces and not something that can be read
   * off the typed text of a handwritten page -- only the marker looking at both
   * can tell, and it can only tell if it has both.
   */
  if (MARKING.test(input.message)) {
    const pageNumbers = back(1);
    return pageNumbers.length > 0
      ? { pageNumbers, reason: "marking_request" }
      : null;
  }

  /*
   * The question is somewhere else. A page with working but no prompt, where an
   * earlier page has one, is the second half of something -- so the page that
   * states it is worth reading even though the student did not say so.
   */
  if (!input.currentPageHasQuestion && input.earlierPageHasQuestion) {
    const pageNumbers = back(2);
    return pageNumbers.length > 0
      ? { pageNumbers, reason: "question_elsewhere" }
      : null;
  }

  /*
   * Almost nothing on this page. Either the student has just turned over and is
   * asking about what they were doing, or the page is genuinely empty and one
   * neighbour costs little to check.
   */
  if (input.currentPageTextLength < 40) {
    const pageNumbers = back(1);
    return pageNumbers.length > 0
      ? { pageNumbers, reason: "sparse_current_page" }
      : null;
  }

  return null;
}
