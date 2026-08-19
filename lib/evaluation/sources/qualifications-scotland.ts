import type { MarkingCorpusRecord, MarkingCriterion } from "@/lib/evaluation/marking-corpus";
import type { PdfPageText } from "./pdf-text.ts";

/**
 * Parser for `qualifications-scotland` — Understanding Standards.
 *
 * The first board source, and the reason it was worth doing first: its
 * commentaries are written mark by mark. Where every other source says a script
 * scored four out of six, this one says which mark was withheld and why —
 * "Mark 2 not awarded – error in gradient formula" — which is exactly the
 * output Jami has to produce. A total can be reached by luck; a criterion
 * cannot.
 *
 * Three files describe one candidate between them, and the parser's real job is
 * keeping them aligned:
 *
 *   - the commentary names question, candidate and each mark's fate;
 *   - the candidate evidence holds the scanned script, with only the
 *     question and candidate labels in its text layer;
 *   - the question paper and marking instructions give the wording and scheme.
 *
 * The evidence carries no marks and the commentary carries no working, so a
 * record is only meaningful when both agree on which candidate answered which
 * question. Where they disagree the candidate is dropped rather than guessed
 * at, because a mark attached to the wrong script is worse than none.
 *
 * Two honest limits are recorded rather than papered over. The commentary does
 * not always adjudicate every mark in a question — a candidate may have three
 * of five marks discussed and the rest passed over in silence — so `maxMarks`
 * counts the marks the examiner actually ruled on, never the question's full
 * tariff, and the shortfall is flagged. And the scans put more than one
 * candidate on some pages, so evidence is referenced to the page, not to a
 * region of it.
 */

/** The bullet the commentaries use for every mark statement. */
const BULLET = /^[♦•]\s*/;

/**
 * `Mathematics Higher Question Paper 1 2023 Commentary SQA | ... 3 of 9`
 *
 * The footer is extracted glued to whatever word ended the page —
 * "Mark 3 not awardedMathematics Higher..." — which makes this pattern
 * load-bearing. Anything that reaches backwards over letters to find the
 * subject swallows the end of the sentence with it, turning "Mark 3 not
 * awarded" into "Mark 3 not" and silently inverting the examiner's verdict.
 * The subject is therefore a capitalised word matched case-sensitively: with
 * the `i` flag, `[A-Z]` matches lower case too and the pattern eats the
 * preceding word. Deliberately not case-insensitive.
 */
const FOOTER =
  /([A-Z][a-z]+)?\s*(Advanced Higher|Higher|National \d)\s*Question Paper \d+ \d{4}\s*(Commentaries|Commentary|Candidate Evidence)\s*SQA \| www\.understandingstandards\.org\.uk\s*\d+ of \d+/g;

const QUESTION_LABEL = /^Question (\d+)/;
const CANDIDATE_LABEL = /^Candidate (\d+)/;

export type { PdfPageText } from "./pdf-text.ts";

/** A positioned run of text, needed to read the marking instructions' columns. */
export type PositionedText = { x: number; y: number; text: string };
export type PdfPageItems = { page: number; items: readonly PositionedText[] };

/**
 * Column boundaries in the marking instructions, in PDF points on a 595-point
 * page. The table has four columns — question, generic scheme, illustrative
 * scheme, max mark — and they cannot be told apart in reading order, because
 * both scheme columns bullet their entries the same way and the extractor
 * interleaves them. Position is the only thing that separates them.
 *
 * Notes beneath a table sit in the question column's range, which is what keeps
 * them out of the criteria.
 */
const GENERIC_COLUMN_START = 120;
/**
 * Where a description's text starts, past the bullet and its number. A run
 * left of this is the bullet marking a new mark; a run at or right of it is
 * the description, including one that wrapped onto another line.
 */
const GENERIC_TEXT_START = 136;
const ILLUSTRATIVE_COLUMN_START = 300;
const MAX_MARK_COLUMN_START = 480;
/**
 * Two runs within this many points of each other are on the same line.
 *
 * Kept tight on purpose. Mark numbers are drawn a few points above their own
 * bullet, so a loose tolerance chains them onto the row above — which put every
 * mark number on the question heading's line and cost the parser two thirds of
 * its descriptions.
 */
const LINE_TOLERANCE = 2;

/**
 * One question of a paper, read off the PDFs by a vision pass.
 *
 * The question papers and marking instructions both carry a text layer, and
 * neither survives extraction: `Given that 5 3 4 10 y x x , where 0 x , find
 * dy dx` is question 1 with its operators, superscripts and relations dropped
 * into symbol fonts that have no character map. A parser would put that in the
 * corpus, where it would read as a question rather than as damage.
 *
 * So this arrives already transcribed, checked by hand against the source, and
 * is treated here as data the parser trusts but does not verify beyond making
 * sure it lines up with the commentaries.
 */
export type QsTranscribedQuestion = {
  /** As the paper prints it: `13(a)(ii)` where it splits, `6` where it does not. */
  questionId: string;
  prompt: string;
  /** The generic and illustrative scheme for this part, as printed. */
  scheme: string;
  /** One per numbered bullet in the generic scheme, in order. */
  marks: readonly { id: string; description: string }[];
};

export type QsPaper = {
  /** Short identifier used in record ids, e.g. `paper-1`. */
  id: string;
  commentaryPages: readonly PdfPageText[];
  evidencePages: readonly PdfPageText[];
  /** Path to the candidate evidence PDF, for the record's answer. */
  evidenceFile: string;
  /** Positioned text from the marking instructions, if they were supplied. */
  instructionPages?: readonly PdfPageItems[];
  /** The paper's questions, transcribed, if a transcription was supplied. */
  transcript?: readonly QsTranscribedQuestion[];
};

export type QsInput = {
  /** e.g. `higher-maths-2023` */
  seriesId: string;
  subject: string;
  papers: readonly QsPaper[];
};

export type QsResult = {
  records: MarkingCorpusRecord[];
  issues: string[];
  stats: {
    candidates: number;
    ingested: number;
    criteria: number;
    criteriaWithReason: number;
    followThrough: number;
    /** Candidates whose commentary rules on fewer marks than the question has. */
    partialCommentary: number;
    unmatchedEvidence: number;
    questionMismatches: number;
    unreadableStatements: number;
    /** Criteria carrying the scheme's text for what the mark is for. */
    describedCriteria: number;
  };
};

const stripFooters = (text: string) => text.replace(FOOTER, "\n");

/**
 * The commentary as lines, with wrapped text folded back onto its bullet.
 *
 * A reason routinely runs onto the next line, and the page footer lands in the
 * middle of a sentence, so nothing can be read line by line until both are
 * dealt with.
 */
export function readCommentaryLines(pages: readonly PdfPageText[]) {
  const joined = stripFooters(pages.map((page) => page.text).join("\n")).replace(/[ \t]+/g, " ");
  const lines: string[] = [];
  for (const raw of joined.split("\n").map((line) => line.trim()).filter(Boolean)) {
    const isNew = BULLET.test(raw) || QUESTION_LABEL.test(raw) || CANDIDATE_LABEL.test(raw);
    if (isNew || lines.length === 0) lines.push(raw);
    else lines[lines.length - 1] += ` ${raw}`;
  }
  return lines;
}

/** `Marks 3, 4 and 5` -> [3, 4, 5]. Singular and plural are written both ways. */
function markNumbers(list: string) {
  return [...list.matchAll(/\d+/g)].map((match) => Number(match[0]));
}

export type MarkStatement =
  | { kind: "criteria"; criteria: MarkingCriterion[] }
  | { kind: "unreadable"; text: string };

/**
 * One bullet from a commentary.
 *
 * Handles the forms the boards actually write: a single mark, a run of marks
 * sharing one verdict, a fraction where the marks are not individually
 * identified, and follow-through — including the source's own misspelling of
 * it. A bullet that states no verdict is a note about the question rather than
 * a judgement on a mark, and is reported instead of being counted either way.
 */
export function parseMarkStatement(line: string): MarkStatement {
  const body = line.replace(BULLET, "").trim();
  const [claim, ...rest] = body.split(/\s+[–—-]\s+/);
  const reason = rest.join(" - ").trim() || undefined;

  const fraction = /^(\d+)\s*\/\s*(\d+)\s+(not\s+)?awarded/i.exec(claim);
  if (fraction) {
    const available = Number(fraction[2]);
    const awarded = fraction[3] ? 0 : Number(fraction[1]);
    return {
      kind: "criteria",
      criteria: [
        { id: `Marks 1-${available}`, available, awarded, ...(reason ? { reason } : {}) },
      ],
    };
  }

  const statement = /^Marks?\s+([\d,\s and]+?)\s+(not\s+)?awarded(\s+on\s+follow-thr?ough)?/i.exec(claim);
  if (!statement) return { kind: "unreadable", text: body };

  const numbers = markNumbers(statement[1]);
  if (numbers.length === 0) return { kind: "unreadable", text: body };

  const awarded = statement[2] ? 0 : 1;
  const followThrough = Boolean(statement[3]);
  return {
    kind: "criteria",
    criteria: numbers.map((number) => ({
      id: `Mark ${number}`,
      available: 1,
      awarded,
      ...(reason ? { reason } : {}),
      ...(followThrough ? { followThrough } : {}),
    })),
  };
}

type Entry = { question: number; candidate: number; lines: string[] };

/** Walk the commentary, grouping bullets under their question and candidate. */
export function readCommentaryEntries(pages: readonly PdfPageText[]) {
  const entries: Entry[] = [];
  let question: number | null = null;
  for (const line of readCommentaryLines(pages)) {
    const questionLabel = QUESTION_LABEL.exec(line);
    if (questionLabel) {
      question = Number(questionLabel[1]);
      continue;
    }
    const candidateLabel = CANDIDATE_LABEL.exec(line);
    if (candidateLabel) {
      entries.push({ question: question ?? 0, candidate: Number(candidateLabel[1]), lines: [] });
      continue;
    }
    if (BULLET.test(line) && entries.length > 0) entries[entries.length - 1].lines.push(line);
  }
  return entries;
}

export type EvidenceLocation = {
  question: number;
  firstPage: number;
  lastPage: number;
  /** Another candidate's work starts on the same page. */
  sharesPage: boolean;
};

/**
 * Where each candidate's script sits in the evidence PDF.
 *
 * The text layer holds nothing but the labels — the work itself is a scan — so
 * this is a page index, and where two candidates start on one page both are
 * marked as sharing it rather than pretending to a precision the file does not
 * support.
 */
export function readEvidenceIndex(pages: readonly PdfPageText[]) {
  const found: { candidate: number; question: number; page: number }[] = [];
  let question = 0;
  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    for (const match of stripFooters(page.text).matchAll(/(Question|Candidate)\s+(\d+)/g)) {
      if (match[1] === "Question") question = Number(match[2]);
      else found.push({ candidate: Number(match[2]), question, page: page.page });
    }
  }

  const index = new Map<number, EvidenceLocation>();
  const lastPage = pages.reduce((highest, page) => Math.max(highest, page.page), 0);
  for (const [position, entry] of found.entries()) {
    if (index.has(entry.candidate)) continue;
    const next = found[position + 1];
    index.set(entry.candidate, {
      question: entry.question,
      firstPage: entry.page,
      lastPage: next ? Math.max(entry.page, next.page - 1) : lastPage,
      sharesPage: next?.page === entry.page,
    });
  }
  return index;
}

export type QuestionScheme = {
  /** What each mark is for, in the order the scheme lists them. */
  descriptions: string[];
  /** The question's real tariff, summed over the pages it spans. */
  tariff: number;
};

/**
 * Read the generic scheme out of the marking instructions.
 *
 * The generic scheme is the column that says what each mark is *for* — "use the
 * discriminant", "apply condition and express in standard quadratic form" —
 * which is the missing half of a criterion record. Without it a record says a
 * mark was withheld and why; with it, it also says what the candidate was
 * supposed to have done.
 *
 * A question can run over more than one page and can be split into parts, each
 * restarting its bullets at 1. The commentaries number a question's marks
 * straight through those parts, so the descriptions are concatenated in page
 * order to match, and the tariff is summed the same way.
 */
export function parseMarkingInstructions(pages: readonly PdfPageItems[]) {
  const schemes = new Map<number, QuestionScheme>();
  let question: number | null = null;

  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    // Group the runs into lines by vertical position, top of the page first.
    // Sorting before grouping keeps this independent of the order the
    // extractor happened to emit the runs in.
    const sorted = page.items.filter((item) => item.text.trim()).sort((a, b) => b.y - a.y);
    const lines: PositionedText[][] = [];
    for (const item of sorted) {
      const current = lines[lines.length - 1];
      if (current && Math.abs(current[0].y - item.y) <= LINE_TOLERANCE) current.push(item);
      else lines.push([item]);
    }

    /**
     * Each table is followed on the same page by the examiner's notes and a
     * set of worked candidate responses. Those spill into the generic scheme's
     * column and are not part of the scheme, so everything below the marker is
     * ignored — without this the parser collected forty-two "marks" for a
     * nine-mark question.
     */
    let belowTable = false;

    for (const line of lines) {
      const runs = [...line].sort((a, b) => a.x - b.x);
      // Joined with spaces, unlike the cells themselves: this is only used to
      // recognise the table's furniture, and "QuestionGeneric scheme" run
      // together defeats the word boundary that recognises the header row.
      const whole = runs.map((run) => run.text).join(" ").replace(/\s+/g, " ").trim();
      if (/^(Notes:|Commonly Observed Responses)/i.test(whole)) belowTable = true;
      if (belowTable) continue;
      // Every page repeats the table's own header row, and a question running
      // over a page break would otherwise collect it as more of its last mark.
      if (/^Question\b/.test(whole) || /^Generic scheme$/i.test(whole)) continue;
      const cell = (from: number, to: number) =>
        runs
          .filter((run) => run.x >= from && run.x < to)
          .map((run) => run.text)
          .join("")
          .replace(/\s+/g, " ")
          .trim();

      const questionCell = cell(0, GENERIC_COLUMN_START);
      const genericCell = cell(GENERIC_COLUMN_START, ILLUSTRATIVE_COLUMN_START);
      const maxCell = cell(MAX_MARK_COLUMN_START, Number.MAX_SAFE_INTEGER);

      /**
       * A question heading, and not a numbered note.
       *
       * The notes beneath each table number themselves "1.", "2." in the same
       * column as the question, so shape alone cannot tell them apart — and
       * reading a note number as a question silently reassigns every
       * description after it. What separates them is the tariff: a question's
       * row carries its mark total in the last column, and a note never does.
       */
      const heading = /^(\d+)\.?$/.exec(questionCell);
      const tariff = Number(maxCell);
      if (heading && maxCell !== "" && Number.isFinite(tariff)) {
        question = Number(heading[1]);
        const scheme = schemes.get(question) ?? { descriptions: [], tariff: 0 };
        scheme.tariff += tariff;
        schemes.set(question, scheme);
      }

      if (question === null || !genericCell) continue;
      const scheme = schemes.get(question);
      if (!scheme) continue;

      // A new mark is marked by its bullet's position, not by parsing its
      // number: the number is drawn out of line with its own bullet and cannot
      // be relied on to be in this cell at all. Position is what holds.
      const startsMark = runs.some(
        (run) => run.x >= GENERIC_COLUMN_START && run.x < GENERIC_TEXT_START
      );
      if (startsMark) {
        const description = genericCell.replace(/^[•♦]?\s*\d*\s*/, "").trim();
        // The stray mark number on its own is not a description.
        if (description) scheme.descriptions.push(description);
      } else if (scheme.descriptions.length > 0) {
        // A description that wrapped onto the next line of the same cell.
        scheme.descriptions[scheme.descriptions.length - 1] =
          `${scheme.descriptions[scheme.descriptions.length - 1]} ${genericCell}`.trim();
      }
    }
  }
  return schemes;
}

/**
 * The transcribed parts of one question, in the order the paper prints them.
 *
 * A record covers a whole question -- `q13` -- while the paper splits it into
 * `13(a)(i)`, `13(a)(ii)`, `13(b)(i)` and `13(b)(ii)`. The commentaries number
 * marks straight through that split, so the parts have to be put back in order
 * before a mark number means anything.
 */
export function transcribedParts(
  transcript: readonly QsTranscribedQuestion[],
  question: number
) {
  return transcript.filter(
    (entry) => Number(entry.questionId.match(/^\d+/)?.[0]) === question
  );
}

/**
 * The parts a commentary of `count` marks covers, or null when they cannot be
 * identified.
 *
 * A commentary does not always rule on the whole question: eleven of the
 * eighty-nine stop early, and one covering three marks of question 11 is
 * ruling on 11(a), not on some three marks scattered through it. Every partial
 * commentary in this source is a prefix, so the parts are taken in order until
 * their marks add up.
 *
 * Returns null when they do not add up exactly. That happens where the parser
 * and the paper disagree about how many marks a question has, and pairing them
 * anyway would label every mark as the wrong one -- a quieter failure than no
 * description at all, and the reason this fails closed rather than guessing.
 */
export function partsCovering(
  parts: readonly QsTranscribedQuestion[],
  count: number
) {
  const taken: QsTranscribedQuestion[] = [];
  let marks = 0;
  for (const part of parts) {
    if (marks >= count) break;
    marks += part.marks.length;
    taken.push(part);
  }
  return marks === count && taken.length > 0 ? taken : null;
}

export function parseQualificationsScotland(input: QsInput): QsResult {
  const records: MarkingCorpusRecord[] = [];
  const issues: string[] = [];
  let candidates = 0;
  let criteriaCount = 0;
  let criteriaWithReason = 0;
  let followThrough = 0;
  let partialCommentary = 0;
  let unmatchedEvidence = 0;
  let questionMismatches = 0;
  let unreadableStatements = 0;
  let describedCriteria = 0;
  const mismatchedSchemes = new Set<number>();

  for (const paper of input.papers) {
    const entries = readCommentaryEntries(paper.commentaryPages);
    const evidence = readEvidenceIndex(paper.evidencePages);
    const schemes = paper.instructionPages
      ? parseMarkingInstructions(paper.instructionPages)
      : new Map<number, QuestionScheme>();
    const transcript = paper.transcript ?? [];

    // The question's tariff is the highest mark any candidate was judged on.
    // It is only used to notice a commentary that stops short, never to invent
    // a verdict on a mark the examiner passed over.
    const tariff = new Map<number, number>();
    for (const entry of entries) {
      for (const line of entry.lines) {
        const statement = parseMarkStatement(line);
        if (statement.kind !== "criteria") continue;
        for (const criterion of statement.criteria) {
          const highest = criterion.id.startsWith("Marks 1-")
            ? criterion.available
            : Math.max(...markNumbers(criterion.id));
          tariff.set(entry.question, Math.max(tariff.get(entry.question) ?? 0, highest));
        }
      }
    }

    for (const entry of entries) {
      candidates += 1;
      const criteria: MarkingCriterion[] = [];
      for (const line of entry.lines) {
        const statement = parseMarkStatement(line);
        if (statement.kind === "unreadable") {
          unreadableStatements += 1;
          issues.push(
            `${paper.id} candidate ${entry.candidate}: no verdict in "${statement.text}"; not counted either way.`
          );
          continue;
        }
        criteria.push(...statement.criteria);
      }

      if (criteria.length === 0) {
        issues.push(`${paper.id} candidate ${entry.candidate}: no mark statements; skipped.`);
        continue;
      }

      const located = evidence.get(entry.candidate);
      if (!located) {
        unmatchedEvidence += 1;
        issues.push(
          `${paper.id} candidate ${entry.candidate}: commentary has no matching script in the evidence; skipped.`
        );
        continue;
      }
      if (located.question !== entry.question) {
        questionMismatches += 1;
        issues.push(
          `${paper.id} candidate ${entry.candidate}: commentary puts them on question ${entry.question}, the evidence on question ${located.question}; skipped.`
        );
        continue;
      }

      /**
       * Attach what each mark is for, but only where the scheme and the
       * commentary agree on how many marks the question has. If they do not,
       * the two are numbered differently and pairing them by position would
       * describe every mark as the wrong one — a quieter and worse failure
       * than having no description at all.
       */
      const scheme = schemes.get(entry.question);
      const schemeMatches =
        scheme !== undefined &&
        scheme.descriptions.length === (tariff.get(entry.question) ?? scheme.descriptions.length);
      if (scheme && !schemeMatches && !mismatchedSchemes.has(entry.question)) {
        mismatchedSchemes.add(entry.question);
        issues.push(
          `${paper.id} question ${entry.question}: the scheme lists ${scheme.descriptions.length} marks but the commentaries go up to ${tariff.get(entry.question)}; descriptions withheld for this question.`
        );
      }
      if (schemeMatches && scheme) {
        for (const criterion of criteria) {
          const number = Math.max(...markNumbers(criterion.id));
          const description = scheme.descriptions[number - 1];
          if (description) {
            criterion.description = description;
            describedCriteria += 1;
          }
        }
      }

      /**
       * The question itself, and the scheme it is marked by.
       *
       * Without these a record is a photograph of somebody's working beside a
       * list reading `Mark 1 ... Mark 7`, which is a harder job than the one
       * the product does and makes any score off this source a floor rather
       * than a measurement. Only the parts this commentary actually rules on
       * are attached, so a marker is never shown a mark scheme for work it has
       * not been asked to judge.
       */
      const parts = partsCovering(
        transcribedParts(transcript, entry.question),
        criteria.length
      );
      if (parts) {
        const bullets = parts.flatMap((part) => part.marks);
        for (const [position, criterion] of criteria.entries()) {
          const description = bullets[position]?.description;
          if (!description) continue;
          /**
           * The transcription wins where both read the same bullet.
           *
           * They agree on the words -- 114 of the 115 transcribed descriptions
           * appear verbatim in the instruction PDF's own text layer -- but not
           * on the spacing, because positioned text arrives with the gaps
           * between runs missing. The instruction reader produced
           * `calculatey-coordinate` for what the scheme prints as `calculate
           * y-coordinate`, and a marker should not be told to look for a word
           * that is not a word.
           */
          if (!criterion.description) describedCriteria += 1;
          criterion.description = description;
        }
      } else if (transcript.length > 0) {
        issues.push(
          `${paper.id} candidate ${entry.candidate}: question ${entry.question}'s parts do not add up to the ${criteria.length} marks the commentary rules on; question text withheld for this candidate.`
        );
      }

      const available = criteria.reduce((total, criterion) => total + criterion.available, 0);
      const awarded = criteria.reduce((total, criterion) => total + criterion.awarded, 0);
      const questionTariff = scheme?.tariff || tariff.get(entry.question) || available;
      const partial = available < questionTariff;
      if (partial) partialCommentary += 1;

      criteriaCount += criteria.length;
      criteriaWithReason += criteria.filter((criterion) => criterion.reason).length;
      followThrough += criteria.filter((criterion) => criterion.followThrough).length;

      const reference = `${paper.evidenceFile}#page=${located.firstPage}${
        located.lastPage > located.firstPage ? `-${located.lastPage}` : ""
      }`;

      const commentary = criteria
        .map(
          (criterion) =>
            `${criterion.id}${criterion.description ? ` (${criterion.description})` : ""}: ` +
            `${criterion.awarded > 0 ? "awarded" : "not awarded"}` +
            `${criterion.followThrough ? " on follow-through" : ""}` +
            `${criterion.reason ? ` — ${criterion.reason}` : ""}`
        )
        .join("\n");

      records.push({
        id: `qs:${input.seriesId}:${paper.id}:q${entry.question}:c${entry.candidate}`,
        sourceId: "qualifications-scotland",
        // Scottish Higher, which sits above National 5 and alongside the first
        // year of A-level. There is no closer bucket in MarkingLevel.
        level: "alevel",
        subject: input.subject,
        // Marks are credited one at a time for method and accuracy, including
        // on follow-through from a candidate's own earlier error.
        regime: "additive",
        questionId: `q${entry.question}`,
        questionPrompt: parts ? parts.map((part) => part.prompt).join("\n\n") : "",
        ...(parts ? { markScheme: parts.map((part) => part.scheme).join("\n\n") } : {}),
        answer: { kind: "image", paths: [reference] },
        humanMarks: [awarded],
        // The marks the examiner actually ruled on, which is not always the
        // whole question. Never the tariff, or the marks passed over in
        // silence would be recorded as refusals.
        maxMarks: available,
        examinerCommentary: commentary,
        criteria,
      });

      if (partial) {
        issues.push(
          `${paper.id} candidate ${entry.candidate}: commentary rules on ${available} of question ${entry.question}'s ${questionTariff} marks; recorded out of ${available}.`
        );
      }
      if (located.sharesPage) {
        issues.push(
          `${paper.id} candidate ${entry.candidate}: page ${located.firstPage} carries more than one candidate, so the reference is to the page, not to their work alone.`
        );
      }
    }
  }

  return {
    records,
    issues,
    stats: {
      candidates,
      ingested: records.length,
      criteria: criteriaCount,
      criteriaWithReason,
      followThrough,
      partialCommentary,
      unmatchedEvidence,
      questionMismatches,
      unreadableStatements,
      describedCriteria,
    },
  };
}
