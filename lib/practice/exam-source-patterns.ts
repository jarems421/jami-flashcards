import type { ExamBoardId } from "@/lib/practice/exam-formats";

/**
 * Where each board actually puts its past papers.
 *
 * There is no shared answer to this. The boards' past-paper pages are all
 * JavaScript search interfaces -- measured: zero PDF links in the HTML of
 * AQA's, Pearson's and OCR's -- so scraping a listing finds nothing, whatever
 * the parser. What does work differs per board, so each one says for itself
 * how its files are addressed and the caller checks which of them exist.
 *
 * The three shapes, established by fetching real URLs:
 *
 *  - AQA files are fully determined by the specification, component, series
 *    and year, so its candidates are exact and there is only ever one.
 *  - Pearson names a paper after the day it was sat and its scheme after the
 *    day results were released, neither of which can be derived -- but both
 *    fall in a short known window, so they are worth probing.
 *  - OCR uses an opaque asset id per document. Nothing derives it, so OCR has
 *    no pattern and its papers are supplied by hand.
 */
export type ExamSourceCandidate = {
  questionPaperUrl: string;
  markSchemeUrl: string;
  label: string;
};

export type ExamSeries = "June" | "November";

export type ExamSourceQuery = {
  board: ExamBoardId;
  specificationId: string;
  componentCode: string;
  year: number;
  series: ExamSeries;
};

const MONTHS: Record<ExamSeries, { path: string; short: string }> = {
  June: { path: "june", short: "JUN" },
  November: { path: "november", short: "NOV" },
};

/**
 * AQA: one exact candidate.
 *
 * `AQA-{spec}{component}-QP-{MON}{YY}.PDF`, with `-MS-` for the scheme, under
 * the series directory. Both confirmed against the live filestore.
 */
function aqaCandidates(query: ExamSourceQuery): ExamSourceCandidate[] {
  const month = MONTHS[query.series];
  const stem = `${query.specificationId}${query.componentCode}`.replace(/[^A-Za-z0-9]/g, "");
  const suffix = `${month.short}${String(query.year).slice(2)}`;
  const base = `https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/${query.year}/${month.path}`;
  return [{
    questionPaperUrl: `${base}/AQA-${stem}-QP-${suffix}.PDF`,
    markSchemeUrl: `${base}/AQA-${stem}-MS-${suffix}.PDF`,
    label: `AQA ${query.specificationId}/${query.componentCode} ${query.series} ${query.year}`,
  }];
}

/** The days a series is sat on, and the days its results are released. */
const SITTING_WINDOWS: Record<ExamSeries, { from: [number, number]; to: [number, number] }> = {
  // Summer papers run from early May to late June.
  June: { from: [5, 1], to: [6, 30] },
  // The autumn resit series is a fortnight in early November.
  November: { from: [11, 1], to: [11, 20] },
};

const RESULTS_WINDOWS: Record<ExamSeries, { from: [number, number]; to: [number, number] }> = {
  // GCSE results are the third or fourth Thursday of August.
  June: { from: [8, 17], to: [8, 28] },
  // Autumn resit results land in the second week of January.
  November: { from: [1, 8], to: [1, 20] },
};

function datesInWindow(year: number, window: { from: [number, number]; to: [number, number] }) {
  const dates: string[] = [];
  const start = Date.UTC(year, window.from[0] - 1, window.from[1]);
  const end = Date.UTC(year, window.to[0] - 1, window.to[1]);
  for (let at = start; at <= end; at += 86_400_000) {
    const date = new Date(at);
    // Papers are not sat at weekends, which halves the probing.
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    dates.push(
      `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`
    );
  }
  return dates;
}

/**
 * Pearson: every plausible sitting day crossed with every plausible results
 * day, which is a lot of candidates and exactly why the caller checks them
 * cheaply and stops at the first that exists.
 */
function pearsonCandidates(query: ExamSourceQuery): ExamSourceCandidate[] {
  const spec = query.specificationId.toLowerCase();
  const component = query.componentCode.replace(/^.*\//, "").toLowerCase();
  const subjectPath = "Mathematics";
  const base = `https://qualifications.pearson.com/content/dam/pdf/GCSE/${subjectPath}/2015/Exam-materials`;
  const resultsYear = query.series === "June" ? query.year : query.year + 1;
  const candidates: ExamSourceCandidate[] = [];
  for (const sat of datesInWindow(query.year, SITTING_WINDOWS[query.series])) {
    for (const released of datesInWindow(resultsYear, RESULTS_WINDOWS[query.series])) {
      candidates.push({
        questionPaperUrl: `${base}/${spec}-${component}-que-${sat}.pdf`,
        markSchemeUrl: `${base}/${spec}-${component}-rms-${released}.pdf`,
        label: `Pearson Edexcel ${query.specificationId}/${query.componentCode} ${query.series} ${query.year}`,
      });
    }
  }
  return candidates;
}

/**
 * Candidate URLs for one paper, best first.
 *
 * An empty list means this board has no derivable address and its papers must
 * be supplied directly -- which is a real answer, not a gap to paper over.
 */
export function examSourceCandidates(query: ExamSourceQuery): ExamSourceCandidate[] {
  if (query.board === "aqa") return aqaCandidates(query);
  if (query.board === "pearson_edexcel") return pearsonCandidates(query);
  return [];
}

export function boardHasSourcePattern(board: ExamBoardId) {
  return board === "aqa" || board === "pearson_edexcel";
}

/** The distinct paper URLs among candidates, so each is only checked once. */
export function distinctQuestionPaperUrls(candidates: ExamSourceCandidate[]) {
  return [...new Set(candidates.map((candidate) => candidate.questionPaperUrl))];
}

export function markSchemeUrlsFor(candidates: ExamSourceCandidate[], questionPaperUrl: string) {
  return [
    ...new Set(
      candidates
        .filter((candidate) => candidate.questionPaperUrl === questionPaperUrl)
        .map((candidate) => candidate.markSchemeUrl)
    ),
  ];
}
