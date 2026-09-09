/**
 * Finding where one question starts and the next begins, from the page itself.
 *
 * A question used to be stored as a render of its whole page, which is wrong
 * twice over: a question continuing onto the next page lost its second half,
 * and every image showed the neighbouring questions a student had not been
 * asked -- more of a licensed paper than the question needed, on every screen.
 *
 * The boundaries come from the text layer rather than from the model. Exam
 * papers put the question number in the left margin on its own, so the start
 * of a question is a deterministic thing to look for, and a coordinate read
 * off the page cannot hallucinate. The model still says which page a question
 * is on; this decides where on it.
 */

export type PdfTextItem = {
  text: string;
  x: number;
  y: number;
  height: number;
};

export type PdfPageText = {
  page: number;
  width: number;
  height: number;
  items: PdfTextItem[];
};

export type QuestionStart = {
  label: string;
  page: number;
  /** Distance from the top of the page, in PDF units. */
  top: number;
};

export type QuestionRegion = {
  page: number;
  /** Fractions of the page height, measured from the top. */
  fromRatio: number;
  toRatio: number;
};

/** How far into the page a number can sit and still be a margin label. */
const MARGIN_RATIO = 0.18;
/** Lines closer together than this are the same line. */
const LINE_TOLERANCE = 3;
/** A question label: 1, 12, 3. — not a year, a mark total or a page number. */
const LABEL_PATTERN = /^(\d{1,2})\s*[.)]?$/;

function sameLine(a: number, b: number) {
  return Math.abs(a - b) <= LINE_TOLERANCE;
}

/**
 * The question numbers printed in the left margin, top to bottom.
 *
 * Only whole numbers, and only in the margin: a part label like `(a)` sits
 * inside its question rather than starting a new one, and a bare number in the
 * body of the page is far more likely to be an answer or a figure caption.
 */
export function findQuestionStarts(pages: PdfPageText[]): QuestionStart[] {
  const starts: QuestionStart[] = [];
  for (const page of pages) {
    const marginLimit = page.width * MARGIN_RATIO;
    const candidates = page.items
      .filter((item) => item.x <= marginLimit)
      .filter((item) => LABEL_PATTERN.test(item.text.trim()));
    for (const item of candidates) {
      const label = item.text.trim().replace(/[.)]$/, "");
      // A question label has its question beside it. A margin number with an
      // empty line to its right is a page number, not a question.
      const hasQuestionBeside = page.items.some(
        (other) => other !== item && sameLine(other.y, item.y) && other.x > item.x
      );
      if (!hasQuestionBeside) continue;
      starts.push({ label, page: page.page, top: page.height - item.y });
    }
  }
  return starts.sort((left, right) => left.page - right.page || left.top - right.top);
}

/**
 * The slice of the paper one question occupies, possibly across two pages.
 *
 * It runs from its own label to whatever comes next -- the following question,
 * or the bottom of the last page it reaches. A question with no successor on
 * its own page carries on to the end of that page and into the next, which is
 * exactly the continuation the whole-page render used to drop.
 */
export function regionsForQuestion(input: {
  label: string;
  starts: QuestionStart[];
  pages: PdfPageText[];
  /** How far below the label to begin, so its own number is included. */
  headroom?: number;
}): QuestionRegion[] {
  const { starts, pages } = input;
  const index = starts.findIndex((start) => start.label === input.label);
  if (index === -1) return [];
  const start = starts[index];
  const next = starts[index + 1];
  const headroom = input.headroom ?? 6;

  const pageHeight = (page: number) => pages.find((item) => item.page === page)?.height ?? 0;
  const startHeight = pageHeight(start.page);
  if (!startHeight) return [];
  const from = Math.max(0, (start.top - headroom) / startHeight);

  // No following question: the rest of this page, and nothing beyond it.
  if (!next) return [{ page: start.page, fromRatio: from, toRatio: 1 }];

  if (next.page === start.page) {
    const to = Math.min(1, next.top / startHeight);
    return to > from ? [{ page: start.page, fromRatio: from, toRatio: to }] : [];
  }

  const regions: QuestionRegion[] = [{ page: start.page, fromRatio: from, toRatio: 1 }];
  for (let page = start.page + 1; page < next.page; page += 1) {
    regions.push({ page, fromRatio: 0, toRatio: 1 });
  }
  const nextHeight = pageHeight(next.page);
  if (nextHeight) {
    const to = Math.min(1, next.top / nextHeight);
    if (to > 0.02) regions.push({ page: next.page, fromRatio: 0, toRatio: to });
  }
  return regions;
}

/**
 * The tariff each question prints for itself, read from the whole paper.
 *
 * Boards that name the question in the tariff -- "(Total for Question 3 is 4
 * marks)" -- give an exact mapping that needs no region at all, which is both
 * simpler and safer than scanning a cropped area and hoping the only number in
 * it is the right one.
 */
export function readPrintedTariffs(paperText: string): Map<string, number> {
  const tariffs = new Map<string, number>();
  const patterns = [
    // Pearson Edexcel, and OCR in the same words.
    /\(\s*Total for Question\s+(\d{1,2})[^)]*?\bis\s+(\d{1,2})\s+marks?\s*\)/gi,
    // AQA prints the question number first and the total on its own line.
    /\bQuestion\s+(\d{1,2})\s*(?:total)?\s*[:\-]?\s*\[?\s*(\d{1,2})\s+marks?\]?/gi,
  ];
  for (const pattern of patterns) {
    for (const match of paperText.matchAll(pattern)) {
      const label = match[1];
      const marks = Number(match[2]);
      if (marks >= 1 && marks <= 30 && !tariffs.has(label)) tariffs.set(label, marks);
    }
  }
  return tariffs;
}

/**
 * The tariff printed inside one question's own region.
 *
 * The fallback for papers that print a bare `(3)` or `[3 marks]` without
 * naming the question. Returns null rather than a guess when the region holds
 * no tariff marker, because an unverifiable tariff is not a passing one.
 */
export function readPrintedTariff(text: string): number | null {
  const marks = [...text.matchAll(/[([]\s*(\d{1,2})\s*(?:marks?)?\s*[)\]]/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 1 && value <= 30);
  return marks.length ? Math.max(...marks) : null;
}

/**
 * Whether a mark scheme actually has a row for this question.
 *
 * Schemes open with several pages of boilerplate before the table, so the
 * search starts at the table header. Inside it the question number begins its
 * row, which is why a bare "appears somewhere in the document" check passed
 * for numbers that were really part of an answer.
 */
export function schemeCoversQuestion(schemeText: string, label: string): boolean {
  if (!label) return false;
  const header = schemeText.search(/Question\s+(?:Working\s+)?Answer\s+Mark/i);
  const table = header >= 0 ? schemeText.slice(header) : schemeText;
  return new RegExp(`(?:^|\\s)${label}(?:\\s*\\([a-z]+\\))?\\s`, "m").test(table);
}
