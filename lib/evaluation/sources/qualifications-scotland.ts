import type { MarkingCorpusRecord, MarkingCriterion } from "@/lib/evaluation/marking-corpus";

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

export type PdfPageText = { page: number; text: string };

export type QsPaper = {
  /** Short identifier used in record ids, e.g. `paper-1`. */
  id: string;
  commentaryPages: readonly PdfPageText[];
  evidencePages: readonly PdfPageText[];
  /** Path to the candidate evidence PDF, for the record's answer. */
  evidenceFile: string;
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

  for (const paper of input.papers) {
    const entries = readCommentaryEntries(paper.commentaryPages);
    const evidence = readEvidenceIndex(paper.evidencePages);

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

      const available = criteria.reduce((total, criterion) => total + criterion.available, 0);
      const awarded = criteria.reduce((total, criterion) => total + criterion.awarded, 0);
      const questionTariff = tariff.get(entry.question) ?? available;
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
            `${criterion.id}: ${criterion.awarded > 0 ? "awarded" : "not awarded"}` +
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
        questionPrompt: "",
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
    },
  };
}
