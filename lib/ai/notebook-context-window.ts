/**
 * Which pages of a notebook Jami is told about, and in how much detail.
 *
 * A question is very often split across pages: the statement is on one, the
 * working runs onto the next, and the check the student wants is about both.
 * Every page used to get the same thin slice, so the page they were actually
 * continuing from was described no better than one forty pages away.
 *
 * So there are two bands. The pages either side of the current one are the
 * ones the current work plausibly belongs to, and they get enough room to be
 * useful. Everything else stays as a one-line index, which is what makes a
 * long notebook navigable without paying for it on every request.
 */

export const NOTEBOOK_CONTEXT_WINDOW_RADIUS = 3;

/** Room per page for the pages a question is likely to span. */
export const NOTEBOOK_NEARBY_PAGE_TEXT_LIMIT = 1_800;
/** Room per page for everything else, which is there to be found, not read. */
export const NOTEBOOK_DISTANT_PAGE_TEXT_LIMIT = 240;

export type NotebookContextPage = {
  id: string;
  pageNumber: number;
};

export type NotebookContextWindow<Page extends NotebookContextPage> = {
  /** The current page and up to `radius` either side of it, in page order. */
  nearby: Page[];
  /** Every other page, in page order. */
  distant: Page[];
};

/**
 * Splits a notebook's pages into the ones worth describing and the rest.
 *
 * The window is measured in list position rather than page number, so a
 * notebook with gaps in its numbering still gets the three neighbours either
 * side rather than however many happen to fall in a numeric range.
 */
export function selectNotebookContextWindow<Page extends NotebookContextPage>(
  pages: readonly Page[],
  currentPageId: string,
  radius: number = NOTEBOOK_CONTEXT_WINDOW_RADIUS
): NotebookContextWindow<Page> {
  const ordered = [...pages].sort((left, right) => left.pageNumber - right.pageNumber);
  const currentIndex = ordered.findIndex((page) => page.id === currentPageId);
  if (currentIndex === -1) {
    // The current page is not in the loaded set -- a notebook longer than the
    // page limit, say. Nothing is "nearby" in that case, and describing an
    // arbitrary slice as though it were adjacent would be worse than not.
    return { nearby: [], distant: ordered };
  }

  const from = Math.max(0, currentIndex - radius);
  const to = Math.min(ordered.length, currentIndex + radius + 1);
  return {
    nearby: ordered.slice(from, to),
    distant: [...ordered.slice(0, from), ...ordered.slice(to)],
  };
}

/** How much of a page's text to include, given which band it fell into. */
export function getNotebookContextPageTextLimit(isNearby: boolean) {
  return isNearby
    ? NOTEBOOK_NEARBY_PAGE_TEXT_LIMIT
    : NOTEBOOK_DISTANT_PAGE_TEXT_LIMIT;
}
