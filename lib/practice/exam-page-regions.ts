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
/**
 * A part written inside its question: `1(1.1)`.
 *
 * The model numbers some AQA science papers this way. Matched against
 * LABEL_PATTERN it is nothing, so its root fell back to the leading `1` and
 * every part was cropped to question 1's opening sentence -- which prints no
 * tariff. All 31, 43, 45 and 62 questions of four real papers were held back.
 * The part inside is the label, when it agrees with the question outside.
 */
const WRAPPED_PART_PATTERN = /^0*(\d{1,2})\((0*(\d{1,2})[.]\d{1,2})\)$/;

export function normaliseQuestionLabel(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "");
  const wrapped = compact.match(WRAPPED_PART_PATTERN);
  const label = wrapped && Number(wrapped[1]) === Number(wrapped[3]) ? wrapped[2] : compact;
  const match = label.match(LABEL_PATTERN);
  if (!match) return null;
  const question = String(Number(match[1]));
  if (match[2]) return `${question}.${Number(match[2])}`;
  return match[3] ? `${question}(${match[3].toLowerCase()})` : question;
}

/**
 * A lettered part, named the way the paper numbers it.
 *
 * The model sometimes letters AQA science parts -- `1(a)`, `1(b)` -- where the
 * paper prints `01.1` and `01.2`. Neither shape matches the other, so every
 * part fell back to question 1's opening sentence, which prints no tariff, and
 * all 45, 42 and 30 questions of three real papers were held back. When the
 * paper prints numbered parts for that question, the nth letter is the nth
 * part. The printed tariff is still checked against the part it lands on, so a
 * wrong guess is held back rather than published.
 */
export function numberedPartLabel(label: string, starts: readonly QuestionStart[]): string {
  if (starts.some((start) => start.label === label)) return label;
  const lettered = label.match(/^(\d{1,2})\(([a-z])\)$/);
  if (!lettered) return label;
  const numbered = `${lettered[1]}.${lettered[2].charCodeAt(0) - 96}`;
  return starts.some((start) => start.label === numbered) ? numbered : label;
}

/**
 * How the paper itself numbers a part the model named some other way.
 *
 * Finding the right region was not enough: the question was still stored as
 * `3(f)`, so a student saw a number the paper does not print and the reviewer
 * rightly rejected it -- 26 questions across three Combined Science papers.
 * Returns the printed reference (`03.6`) and the label shape every other AQA
 * science question carries, or null when the model's own label already was
 * the paper's.
 */
export function printedPartReference(rawNumber: string, printedLabel: string) {
  const own = normaliseQuestionLabel(rawNumber) ?? rootQuestionLabel(rawNumber);
  const part = printedLabel.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (!part || own === printedLabel) return null;
  return {
    reference: `${part[1].padStart(2, "0")}.${part[2]}`,
    label: `Question ${part[1]} (${printedLabel})`,
  };
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
 *
 * Except that furniture does not always sit to the right. Pearson prints "DO
 * NOT WRITE IN THIS AREA" down the left edge of every page, at x=50 on 1MA1/2H,
 * 39 times -- busy enough to be a column, and left of the question numbers at
 * x=71. It became the margin's edge, no number was left of it, and every
 * question on the paper lost its region. The dotted answer lines at x=71 were
 * waiting to do the same.
 *
 * So a column is counted by how many different things it says. Prose never
 * repeats a line; furniture only ever says one thing, however often. And a
 * run with no letters in it is an answer line, not prose.
 */
function bodyTextStart(pages: PdfPageText[], fallback: number) {
  const lines = new Map<number, Set<string>>();
  for (const page of pages) {
    for (const item of page.items) {
      const text = item.text.trim();
      if (text.length < BODY_TEXT_MIN_LENGTH || !/[a-z]/i.test(text)) continue;
      const column = Math.round(item.x);
      const seen = lines.get(column) ?? new Set<string>();
      seen.add(text);
      lines.set(column, seen);
    }
  }
  if (lines.size === 0) return fallback;
  const counts = [...lines].map(([column, texts]) => [column, texts.size] as const);
  const busiest = Math.max(...counts.map(([, count]) => count));
  const threshold = Math.max(MIN_COLUMN_LINES, busiest * COLUMN_SHARE);
  const columns = counts
    .filter(([, count]) => count >= threshold)
    .map(([column]) => column);
  return columns.length ? Math.min(...columns) : fallback;
}

/**
 * A question whose number stands alone because the question opens on a figure.
 *
 * Pearson's 1MA1/3H June 2023 prints `16` at the top of its page and then a
 * diagram, with the first line of wording well below it -- so nothing sits
 * beside the number, and it was dropped as a page number. The question lost
 * its region, and the student lost the question.
 *
 * A page number and a lone question number differ in two ways the paper
 * shows. A question number sits in the column every other question number
 * sits in -- x=70.9 there, where the page number is at 77.6 -- and it is the
 * number missing between the questions either side of it. Both are required,
 * so a page number that happens to fit the sequence is still refused by its
 * column, and a stray number in the column with no neighbours is refused by
 * the sequence.
 */
function questionsOpeningOnAFigure(
  starts: readonly QuestionStart[],
  bare: ReadonlyArray<QuestionStart & { x: number }>,
  labelColumns: readonly number[]
): QuestionStart[] {
  if (labelColumns.length === 0) return [];
  const sorted = [...labelColumns].sort((left, right) => left - right);
  const column = sorted[Math.floor(sorted.length / 2)];
  const order = (left: QuestionStart, right: QuestionStart) => left.page - right.page || left.top - right.top;
  const found = new Map(starts.map((start) => [start.label, start]));
  const rescued: QuestionStart[] = [];
  for (const candidate of bare) {
    if (!/^\d+$/.test(candidate.label) || found.has(candidate.label)) continue;
    if (Math.abs(candidate.x - column) > COLUMN_TOLERANCE) continue;
    const before = found.get(String(Number(candidate.label) - 1));
    const after = found.get(String(Number(candidate.label) + 1));
    if (!before || !after || order(before, candidate) >= 0 || order(candidate, after) >= 0) continue;
    const start = { label: candidate.label, page: candidate.page, top: candidate.top };
    rescued.push(start);
    found.set(start.label, start);
  }
  return rescued;
}

/** A label is printed on the left of the page, never in the right-hand furniture. */
const LABEL_SIDE_RATIO = 0.5;
/** Labels in one column do not sit at exactly the same x on every page. */
const LABEL_COLUMN_TOLERANCE = 4;
/** `0` `1` `.` `1` is four runs; more than that is a sentence, not a label. */
const MAX_LABEL_RUNS = 4;

type LabelCandidate = {
  label: string;
  x: number;
  /** Where the line's text carries on after the label, if it does. */
  bodyX: number | null;
  page: number;
  top: number;
};

/**
 * Every line's leading run, read as a label if it can be.
 *
 * The longest run that parses wins: `1` and `1(a)` both parse on an Edexcel
 * part line, and the part is the more precise answer.
 */
function labelCandidates(pages: PdfPageText[]): LabelCandidate[] {
  const candidates: LabelCandidate[] = [];
  for (const page of pages) {
    const leftOfPage = page.width * LABEL_SIDE_RATIO;
    const lines: PdfTextItem[][] = [];
    for (const item of page.items) {
      const line = lines.find((candidate) => sameLine(candidate[0].y, item.y));
      if (line) line.push(item);
      else lines.push([item]);
    }
    for (const line of lines) {
      const ordered = line.slice().sort((left, right) => left.x - right.x);
      if (ordered[0].x > leftOfPage) continue;
      for (let runs = Math.min(MAX_LABEL_RUNS, ordered.length); runs >= 1; runs -= 1) {
        const label = normaliseQuestionLabel(ordered.slice(0, runs).map((item) => item.text).join(""));
        if (!label) continue;
        candidates.push({
          label,
          x: ordered[0].x,
          bodyX: ordered[runs]?.x ?? null,
          page: page.page,
          top: page.height - ordered[0].y,
        });
        break;
      }
    }
  }
  return candidates;
}

/**
 * How far a column counts the paper's questions off: 1, then 2, then 3.
 *
 * A question's own parts repeat its number, which is why the current number
 * is allowed to recur. Anything else is skipped rather than ending the count,
 * so one stray number in the column does not disqualify it.
 */
function sequenceLength(labels: readonly string[]) {
  let expected = 1;
  for (const label of labels) {
    const root = Number(rootQuestionLabel(label));
    if (root === expected) expected += 1;
  }
  return expected - 1;
}

/**
 * Where the paper's body text begins, decided by the column it numbers in.
 *
 * Prose position alone cannot decide this. An AQA English Language paper sets
 * its reading sources at x=51, left of the `0 1` it numbers questions with, so
 * "the leftmost column of prose" put the margin's edge left of every label:
 * `findQuestionStarts` returned nothing on a 24-page paper, and all five of
 * its questions were held back for having no label, no region and no tariff.
 *
 * A Literature paper fails the other way. Its Shakespeare extract is the
 * busiest column on the paper, and the verse's own line numbers -- 5, 10, 15,
 * 20 -- sit left of it, where they read as questions.
 *
 * The sequence is what tells them apart. A paper counts its questions 1, 2, 3
 * from the top; verse line numbers start at 5 and step by 5, and furniture
 * repeats one value. So each line offers its leading run as a candidate, the
 * candidates cluster by the x they sit at, and the column that counts
 * furthest is the one the paper numbers in. Body text begins where those
 * lines carry on after their label.
 *
 * Null when no column counts past one, which is a paper this cannot read
 * rather than a licence to guess -- the caller falls back to the prose rule.
 */
function labelColumn(pages: PdfPageText[]): { bodyStart: number; candidates: LabelCandidate[] } | null {
  const ordered = labelCandidates(pages).sort(
    (left, right) => left.page - right.page || left.top - right.top
  );
  const clusters: Array<{ x: number; items: LabelCandidate[] }> = [];
  for (const candidate of ordered) {
    const cluster = clusters.find((entry) => Math.abs(entry.x - candidate.x) <= LABEL_COLUMN_TOLERANCE);
    if (cluster) cluster.items.push(candidate);
    else clusters.push({ x: candidate.x, items: [candidate] });
  }

  let best: { score: number; x: number; items: LabelCandidate[] } | null = null;
  for (const cluster of clusters) {
    const score = sequenceLength(cluster.items.map((item) => item.label));
    // Two in a row is the least that can be called counting.
    if (score < 2) continue;
    if (!best || score > best.score || (score === best.score && cluster.x < best.x)) {
      best = { score, x: cluster.x, items: cluster.items };
    }
  }
  if (!best) return null;

  /*
   * The median of where those lines resume, not the smallest: one label whose
   * line happens to carry on early would otherwise move the boundary for the
   * whole paper.
   */
  const bodies = best.items
    .map((item) => item.bodyX)
    .filter((value): value is number => value !== null && value > best!.x)
    .sort((left, right) => left - right);
  if (bodies.length === 0) return null;
  return { bodyStart: bodies[Math.floor(bodies.length / 2)], candidates: best.items };
}

/**
 * A counted question the margin filter read as part of its own sentence.
 *
 * Edexcel Business opens question 5 with "5" beside "Table 2 shows ..." at
 * x=89, while its parts print "(a)" there and their wording at x=108. The body
 * column is the parts' one, so the filter swallowed the number and the
 * sentence together, read no label from "5Table 2 shows ...", and question 5
 * was never found. Its three parts then attached to question 4: two collided
 * with real parts, and the third survived as a "4(c)" three pages later, which
 * stretched question 4(b)'s image across the whole of question 5.
 *
 * Only a candidate that fills a gap in the count is restored -- the number
 * after the question before it, and before the question after it. A bare
 * number with a sentence beside it is otherwise a table row or a figure
 * caption, and admitting those put a "72" among AQA maths's questions.
 *
 * Question 1 has no question before it to be counted from, so it is anchored
 * by what follows instead. Without that, the first question of Edexcel
 * Business 1BS0/02 -- "1" beside "Figure 1 shows a diagram of the product life
 * cycle." -- stayed lost while every later question was restored, and its four
 * parts were held back.
 */
function questionsMissingFromTheCount(
  starts: readonly QuestionStart[],
  candidates: readonly LabelCandidate[]
): QuestionStart[] {
  if (starts.length === 0 || candidates.length === 0) return [];
  const known = new Set(starts.map((start) => start.label));
  const ordered = starts
    .slice()
    .sort((left, right) => left.page - right.page || left.top - right.top);
  const restored: QuestionStart[] = [];
  for (const candidate of candidates) {
    if (candidate.bodyX === null || known.has(candidate.label)) continue;
    const root = Number(rootQuestionLabel(candidate.label));
    if (!Number.isFinite(root)) continue;
    const isBefore = (start: QuestionStart) =>
      start.page < candidate.page || (start.page === candidate.page && start.top < candidate.top);
    const before = ordered.filter(isBefore).pop();
    const after = ordered.find((start) => !isBefore(start));
    if (before && Number(rootQuestionLabel(before.label)) !== root - 1) continue;
    if (!before && root !== 1) continue;
    if (after && Number(rootQuestionLabel(after.label)) !== root + 1) continue;
    // Anchored by one neighbour at least: a lone number counts nothing.
    if (!before && !after) continue;
    known.add(candidate.label);
    restored.push({ label: candidate.label, page: candidate.page, top: candidate.top });
  }
  return restored;
}

/** `(b)` with no number in front of it. */
const LOOSE_PART_PATTERN = /^\(([a-z])\)$/i;
/** `1(a)`: a part numbered beside its question, which says the board numbers parts. */
const INLINE_PART_PATTERN = /^\d{1,2}\([a-z]\)$/;

/**
 * A part printed as `(b)`, on a paper that numbers its first part beside the
 * question.
 *
 * Edexcel Business prints `1 (a)` against question 1 and then `(b)`, `(c)`,
 * `(d)` with no number at all. Read as nothing, every part after the first
 * fell back to a question number that is not itself printed anywhere, so it
 * found no region, no tariff and no label: 27 questions of a real paper were
 * held back for it.
 *
 * Attached to the question whose number last appeared above them, they are
 * their own questions on the page, exactly as `1 (a)` already is.
 *
 * Only where the paper prints a number beside a part somewhere, because that
 * is what says the board numbers parts at all. Edexcel maths sets `(a)` under
 * a bare `5` and prints one total for question 5 covering every part, so
 * nothing there changes.
 */
function looseParts(
  starts: readonly QuestionStart[],
  loose: ReadonlyArray<{ letter: string; page: number; top: number }>
): QuestionStart[] {
  if (loose.length === 0 || !starts.some((start) => INLINE_PART_PATTERN.test(start.label))) return [];
  const ordered = starts
    .slice()
    .sort((left, right) => left.page - right.page || left.top - right.top);
  const attached: QuestionStart[] = [];
  for (const part of loose) {
    const above = ordered.filter(
      (start) => start.page < part.page || (start.page === part.page && start.top < part.top)
    );
    const root = above[above.length - 1];
    if (!root) continue;
    attached.push({
      label: `${rootQuestionLabel(root.label)}(${part.letter})`,
      page: part.page,
      top: part.top,
    });
  }
  return attached;
}

export function findQuestionStarts(pages: PdfPageText[]): QuestionStart[] {
  const starts: QuestionStart[] = [];
  /** Margin numbers with nothing beside them, kept in case a figure is why. */
  const bare: Array<QuestionStart & { x: number }> = [];
  /** Part letters printed with no number, kept until their question is known. */
  const loose: Array<{ letter: string; page: number; top: number }> = [];
  /** Where each accepted question number sits, to recognise the column. */
  const labelColumns: number[] = [];
  // One column for the whole paper: a single page can be dominated by a table
  // or a run of answer lines, and taking its own modal column then puts the
  // boundary in the wrong place for that page alone.
  const fallbackMargin = (pages[0]?.width ?? 600) * MARGIN_RATIO;
  const column = labelColumn(pages);
  const bodyStart = column?.bodyStart ?? bodyTextStart(pages, fallbackMargin);
  for (const page of pages) {
    const lines: PdfTextItem[][] = [];
    for (const item of page.items.filter((candidate) => candidate.x < bodyStart - COLUMN_TOLERANCE)) {
      const line = lines.find((candidate) => sameLine(candidate[0].y, item.y));
      if (line) line.push(item);
      else lines.push([item]);
    }
    for (const line of lines) {
      const ordered = line.slice().sort((left, right) => left.x - right.x);
      const joined = ordered.map((item) => item.text).join("");
      const label = normaliseQuestionLabel(joined);
      const y = line[0].y;
      // A label has its question beside it. A number alone in the margin is
      // usually a page number -- see `questionsOpeningOnAFigure` for when not.
      const hasQuestionBeside = page.items.some(
        (other) => sameLine(other.y, y) && other.x >= bodyStart - COLUMN_TOLERANCE
      );
      if (!label) {
        const part = joined.replace(/\s+/g, "").match(LOOSE_PART_PATTERN);
        if (part && hasQuestionBeside) {
          loose.push({ letter: part[1].toLowerCase(), page: page.page, top: page.height - y });
        }
        continue;
      }
      const start = { label, page: page.page, top: page.height - y };
      if (!hasQuestionBeside) {
        bare.push({ ...start, x: ordered[0].x });
        continue;
      }
      starts.push(start);
      labelColumns.push(ordered[0].x);
    }
  }
  starts.push(...questionsOpeningOnAFigure(starts, bare, labelColumns));
  starts.push(...questionsMissingFromTheCount(starts, column?.candidates ?? []));
  starts.push(...looseParts(starts, loose));
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
    // Pearson Edexcel, and OCR in the same words. Business writes "= 12 marks"
    // where maths writes "is 12 marks".
    /\(\s*Total for Question\s+(\d{1,2})[^)]*?(?:\bis|=)\s+(\d{1,2})\s+marks?\s*\)/gi,
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
 *
 * A tariff that says "marks" is believed over one that does not, because a
 * question's own notation is bracketed too. 8300/1H question 13(b) reads
 * `f(6) / f(2) is equal to f(3)` and prints `[2 marks]`, and taking the
 * largest bracketed number on the page made its tariff 6: the question was
 * held back for disagreeing with a number that was never a tariff. Coordinates
 * and step labels read the same way.
 *
 * Only when nothing in the region says "marks" does a bare bracket count --
 * that is Edexcel, which prints `(3)` against the right margin and nothing
 * else.
 */
const WORDED_TARIFF = /[([]\s*(\d{1,2})\s*marks?\s*[)\]]/gi;
const BARE_TARIFF = /[([]\s*(\d{1,2})\s*[)\]]/g;

function tariffsIn(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 1 && value <= 30);
}

export function readPrintedTariff(text: string): number | null {
  const worded = tariffsIn(text, WORDED_TARIFF);
  if (worded.length) return Math.max(...worded);
  const bare = tariffsIn(text, BARE_TARIFF);
  return bare.length ? Math.max(...bare) : null;
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
