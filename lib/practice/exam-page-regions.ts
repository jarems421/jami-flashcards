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
/** Text this long is prose, so where it starts is where the question starts. */
const BODY_TEXT_MIN_LENGTH = 8;
/** Slack on the body column, which is a rounded average of real positions. */
const COLUMN_TOLERANCE = 2;
/** Lines closer together than this are the same line. */
const LINE_TOLERANCE = 3;
/** A column carries prose only if it repeats; one long line is not a column. */
const MIN_COLUMN_LINES = 3;
/** How busy a column must be, against the busiest, to count as one. */
const COLUMN_SHARE = 0.5;
/**
 * A question label, however the board sets it.
 *
 * Edexcel prints a bare `3`. AQA science prints `0 1 . 1` -- zero padded,
 * sub-part numbered, and split across separate text runs, one per glyph.
 * Matching a single run against a number therefore found every Edexcel
 * question and not one AQA question, and that cascaded: no label meant no
 * region, no region meant no tariff, and no tariff meant every question on
 * the paper was held back. Two hundred and sixteen of them.
 *
 * AQA maths is a third shape again, and it was invisible here for the same
 * reason. It repeats the question number in the margin on every part and puts
 * the letter beside it -- `11` then `(a)` -- so the joined margin line reads
 * `11 (a)` and matched nothing. Every multi-part question on three real
 * papers was rejected: 42 of 42. Worse, a question whose first line is
 * already a part -- 1, 12 and 13 on 8300/1H -- never printed its number
 * alone, so it had no start at all and lost its region too.
 *
 * So the margin is read a line at a time and its runs joined before matching,
 * and the label is normalised -- `01` and `01.1` become `1` and `1.1`, and
 * `11 (a)` becomes `11(a)` -- so the rest of the pipeline sees one shape
 * whoever printed the paper.
 */
const LABEL_PATTERN = /^0*(\d{1,2})(?:[.](\d{1,2}))?[.)]?(?:\(([a-z])\))?$/i;

export function normaliseQuestionLabel(raw: string): string | null {
  const match = raw.replace(/\s+/g, "").match(LABEL_PATTERN);
  if (!match) return null;
  const question = String(Number(match[1]));
  if (match[2]) return `${question}.${Number(match[2])}`;
  return match[3] ? `${question}(${match[3].toLowerCase()})` : question;
}

/** The root a label belongs to: `1.3` and `1` are both question 1. */
export function rootQuestionLabel(raw: string): string {
  const normalised = normaliseQuestionLabel(raw);
  // `1.3` and `11(c)` are both their question: everything from the separator on
  // names the part, whichever separator the board chose.
  if (normalised) return normalised.replace(/[.(].*$/, "");
  const digits = raw.replace(/\s+/g, "").match(/^0*(\d{1,2})/);
  return digits ? String(Number(digits[1])) : "";
}

function sameLine(a: number, b: number) {
  return Math.abs(a - b) <= LINE_TOLERANCE;
}

/**
 * The question numbers printed in the left margin, top to bottom.
 *
 * Only the margin: a number in the body of the page is far more likely to be
 * an answer or a figure caption, and a question label always has its question
 * beside it — a margin number with an empty line to its right is a page
 * number.
 */
/**
 * Where this page's prose begins, which is where a label must end.
 *
 * A fixed gap between glyphs cannot separate the two cases: AQA sets `0` and
 * `1` 16.7 points apart, and Edexcel's question 18 is followed 18.4 points
 * later by the `7` of "7 kg of carrots". Any threshold that keeps AQA's label
 * whole also swallows Edexcel's, and the reverse.
 *
 * The page answers it instead. Prose starts at one x and repeats there on
 * every line -- 114.8 on that AQA paper, 89.3 on that Edexcel one -- and every
 * label sits left of it.
 *
 * The leftmost such column, not the busiest. A paper's furniture repeats on
 * every page and its prose does not: AQA's 8300/2H prints its footer at x=475
 * across 32 pages, which outvoted the 39 lines of actual question text at
 * x=99. "Margin" then meant everything left of 473, so a whole line joined
 * into "5 Jess saves 2p, 5p and 10p coins." and normalised to nothing. Four
 * question starts were found on a paper with twenty-five, and 35 of its 37
 * questions were held back.
 *
 * Body text is left-aligned and furniture sits to its right, so among the
 * columns busy enough to be columns at all, the leftmost is the prose.
 */
function bodyTextStart(pages: PdfPageText[], fallback: number) {
  const counts = new Map<number, number>();
  for (const page of pages) {
    for (const item of page.items) {
      if (item.text.trim().length < BODY_TEXT_MIN_LENGTH) continue;
      const column = Math.round(item.x);
      counts.set(column, (counts.get(column) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return fallback;
  const busiest = Math.max(...counts.values());
  const threshold = Math.max(MIN_COLUMN_LINES, busiest * COLUMN_SHARE);
  const columns = [...counts]
    .filter(([, count]) => count >= threshold)
    .map(([column]) => column);
  return columns.length ? Math.min(...columns) : fallback;
}

export function findQuestionStarts(pages: PdfPageText[]): QuestionStart[] {
  const starts: QuestionStart[] = [];
  // One column for the whole paper: a single page can be dominated by a table
  // or a run of answer lines, and taking its own modal column then puts the
  // boundary in the wrong place for that page alone.
  const fallbackMargin = (pages[0]?.width ?? 600) * MARGIN_RATIO;
  const bodyStart = bodyTextStart(pages, fallbackMargin);
  for (const page of pages) {
    const lines: PdfTextItem[][] = [];
    for (const item of page.items.filter((candidate) => candidate.x < bodyStart - COLUMN_TOLERANCE)) {
      const line = lines.find((candidate) => sameLine(candidate[0].y, item.y));
      if (line) line.push(item);
      else lines.push([item]);
    }
    for (const line of lines) {
      const joined = line
        .slice()
        .sort((left, right) => left.x - right.x)
        .map((item) => item.text)
        .join("");
      const label = normaliseQuestionLabel(joined);
      if (!label) continue;
      const y = line[0].y;
      // A label has its question beside it. A number alone in the margin is a
      // page number, not a question.
      const hasQuestionBeside = page.items.some(
        (other) => sameLine(other.y, y) && other.x >= bodyStart - COLUMN_TOLERANCE
      );
      if (!hasQuestionBeside) continue;
      starts.push({ label, page: page.page, top: page.height - y });
    }
  }
  /*
   * A question number appears once on a paper, so a repeat is a false
   * positive -- a figure caption or an answer line that happens to sit in the
   * margin with text beside it. Keeping the later one would end the earlier
   * question's region in the wrong place, cutting it short.
   */
  const seen = new Set<string>();
  return starts
    .sort((left, right) => left.page - right.page || left.top - right.top)
    .filter((start) => {
      if (seen.has(start.label)) return false;
      seen.add(start.label);
      return true;
    });
}

/**
 * The slice of the paper one question occupies, possibly across two pages.
 *
 * It runs from its own label to whatever comes next -- the following question,
 * or the bottom of the last page it reaches. A question with no successor on
 * its own page carries on to the end of that page and into the next, which is
 * exactly the continuation the whole-page render used to drop.
 */
/**
 * The shared opening a question's parts all depend on.
 *
 * `11 (a) Write down P(A n B)` is unanswerable on its own: the Venn diagram it
 * refers to is printed once, above `(a)`, against the bare `11`. Cropping a
 * part to its own lines therefore hands the student a question with its
 * subject removed. The stem runs from the question's number to wherever its
 * first part begins, and is empty when the paper opens straight onto a part.
 */
function stemRegions(input: {
  root: string;
  starts: QuestionStart[];
  pages: PdfPageText[];
  headroom?: number;
}): QuestionRegion[] {
  const rootIndex = input.starts.findIndex((start) => start.label === input.root);
  if (rootIndex === -1) return [];
  const firstPart = input.starts.findIndex(
    (start, index) =>
      index > rootIndex && start.label !== input.root && rootQuestionLabel(start.label) === input.root
  );
  if (firstPart === -1) return [];
  const start = input.starts[rootIndex];
  const next = input.starts[firstPart];
  const height = input.pages.find((page) => page.page === start.page)?.height ?? 0;
  if (!height) return [];
  const headroom = input.headroom ?? 12;
  const from = Math.max(0, (start.top - headroom) / height);
  if (next.page === start.page) {
    const to = Math.min(1, Math.max(0, next.top - headroom) / height);
    return to > from ? [{ page: start.page, fromRatio: from, toRatio: to }] : [];
  }
  const regions: QuestionRegion[] = [{ page: start.page, fromRatio: from, toRatio: 1 }];
  for (let page = start.page + 1; page < next.page; page += 1) {
    regions.push({ page, fromRatio: 0, toRatio: 1 });
  }
  const nextHeight = input.pages.find((page) => page.page === next.page)?.height ?? 0;
  if (nextHeight) {
    const to = Math.min(1, Math.max(0, next.top - headroom) / nextHeight);
    if (to > 0.02) regions.push({ page: next.page, fromRatio: 0, toRatio: to });
  }
  return regions;
}

export function regionsForQuestion(input: {
  label: string;
  starts: QuestionStart[];
  pages: PdfPageText[];
  /**
   * How far above the label's baseline to begin, so its own line is whole.
   *
   * Applied to both edges. A crop that ends exactly on the next label's
   * baseline still shows that label's glyphs, which sit above it -- so every
   * question image carried the first line of the one after it.
   */
  headroom?: number;
  /** Prepend this question's stem, for a part that would lose its figure. */
  withStemOf?: string;
}): QuestionRegion[] {
  const { starts, pages } = input;
  const index = starts.findIndex((start) => start.label === input.label);
  if (index === -1) return [];
  const start = starts[index];
  const next = starts[index + 1];
  const headroom = input.headroom ?? 12;

  const pageHeight = (page: number) => pages.find((item) => item.page === page)?.height ?? 0;
  const startHeight = pageHeight(start.page);
  if (!startHeight) return [];
  const from = Math.max(0, (start.top - headroom) / startHeight);

  /*
   * The stem comes first because it comes first on the page: a part reads as
   * the question it belongs to followed by what it asks.
   */
  const stem =
    input.withStemOf && input.withStemOf !== input.label
      ? stemRegions({ root: input.withStemOf, starts, pages, headroom: input.headroom })
      : [];
  const withStem = (own: QuestionRegion[]) => {
    if (!own.length || !stem.length) return own;
    // The part's crop opens a little above its own label, so trim the stem
    // where they meet: without it the join repeats a sliver of the page.
    const last = stem[stem.length - 1];
    const first = own[0];
    const trimmed =
      last.page === first.page && last.toRatio > first.fromRatio
        ? [...stem.slice(0, -1), { ...last, toRatio: first.fromRatio }]
        : stem;
    return [...trimmed.filter((region) => region.toRatio > region.fromRatio), ...own];
  };

  // No following question: the rest of this page, and nothing beyond it.
  if (!next) return withStem([{ page: start.page, fromRatio: from, toRatio: 1 }]);

  if (next.page === start.page) {
    const to = Math.min(1, Math.max(0, next.top - headroom) / startHeight);
    return to > from ? withStem([{ page: start.page, fromRatio: from, toRatio: to }]) : [];
  }

  const regions: QuestionRegion[] = [{ page: start.page, fromRatio: from, toRatio: 1 }];
  for (let page = start.page + 1; page < next.page; page += 1) {
    regions.push({ page, fromRatio: 0, toRatio: 1 });
  }
  const nextHeight = pageHeight(next.page);
  if (nextHeight) {
    const to = Math.min(1, Math.max(0, next.top - headroom) / nextHeight);
    if (to > 0.02) regions.push({ page: next.page, fromRatio: 0, toRatio: to });
  }
  return withStem(regions);
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
