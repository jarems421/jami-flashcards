import type { ExamBoardId, ExamQualification } from "@/lib/practice/exam-formats";
import type { StudyLevel } from "@/lib/profile/study-level";

/**
 * Turning a discovered pair of PDFs into something ingestion can accept.
 *
 * Discovery finds two links and a scrap of link text. Ingestion needs to know
 * which paper it is: the year, the series and the paper reference. Those are
 * not in the catalogue and not reliably in the URL, so they are read from the
 * link text here -- a guess, made in one readable place rather than inside a
 * prompt.
 *
 * It is safe to guess because nothing downstream trusts the guess. The
 * extraction pass reads the identity off the paper itself and compares it to
 * the manifest, and a mismatch sends every question in that paper to
 * `needs_review` instead of publishing it. A wrong guess therefore costs a
 * review, never a wrong question in front of a student.
 */
export type ExamPaperCandidate = {
  questionPaperUrl: string;
  markSchemeUrl: string;
  label: string;
};

export type ExamCatalogueCourse = {
  board: ExamBoardId;
  boardLabel: string;
  qualification: ExamQualification;
  subject: string;
  specificationCode: string;
  specificationTitle: string;
  componentCode: string;
  componentTitle: string;
};

const SERIES_PATTERNS: Array<[RegExp, string]> = [
  [/\b(june|summer)\b/i, "June"],
  [/\b(november|autumn)\b/i, "November"],
  [/\b(january|winter)\b/i, "January"],
  [/\b(march)\b/i, "March"],
  [/\b(may)\b/i, "May"],
  [/\b(october)\b/i, "October"],
];

/** Only qualifications this feature serves; everything else has no level. */
const QUALIFICATION_LEVELS: Record<ExamQualification, StudyLevel> = {
  gcse: "gcse-equivalent",
  igcse: "gcse-equivalent",
  national_5: "gcse-equivalent",
  ib_myp: "gcse-equivalent",
  a_level: "post-16-equivalent",
  international_a_level: "post-16-equivalent",
  higher: "post-16-equivalent",
  advanced_higher: "post-16-equivalent",
  ib_diploma: "post-16-equivalent",
};

export function examStudyLevelForQualification(qualification: ExamQualification): StudyLevel {
  return QUALIFICATION_LEVELS[qualification];
}

/** A sitting year, bounded so a spec code or a file id cannot pass as one. */
export function readExamPaperYear(label: string, now = Date.now()): number | null {
  const ceiling = new Date(now).getUTCFullYear() + 1;
  const years = [...label.matchAll(/\b(19|20)\d{2}\b/g)]
    .map((match) => Number(match[0]))
    .filter((year) => year >= 1990 && year <= ceiling);
  // The latest plausible year in the text: a link often carries both the
  // series year and an unrelated one from a spec title or a file path.
  return years.length ? Math.max(...years) : null;
}

export function readExamPaperSeries(label: string): string | null {
  for (const [pattern, series] of SERIES_PATTERNS) {
    if (pattern.test(label)) return series;
  }
  return null;
}

/**
 * The paper's own reference, as printed on it.
 *
 * Boards write these as a spec code and a component joined by a slash or a
 * dash -- 8461/1H, 7402-1, 1BI0/1F. Falling back to the catalogue's own codes
 * keeps the manifest complete; the extraction pass then decides whether it
 * matches what the paper actually says.
 */
export function readExamPaperReference(label: string, course: ExamCatalogueCourse): string {
  const printed = label.match(/\b[0-9]{4}[A-Z]{0,3}\s?[/-]\s?[0-9][A-Z]{0,2}\b/i);
  if (printed) return printed[0].replace(/\s+/g, "");
  return `${course.specificationCode}/${course.componentCode}`;
}

export type ExamPaperManifestDraft = {
  board: ExamBoardId;
  boardLabel: string;
  qualification: ExamQualification;
  specificationId: string;
  specificationTitle: string;
  specificationVersion: string;
  subject: string;
  studyLevel: StudyLevel;
  componentCode: string;
  componentTitle: string;
  year: number;
  series: string;
  paperReference: string;
  activeFrom: number;
  questionPaperUrl: string;
  markSchemeUrl: string;
  rightsKey: string;
  rightsVersion: number;
};

/**
 * A manifest for one discovered paper, or null when the label says too little.
 *
 * A pair whose text names neither a year nor a series is not ingested at all.
 * Guessing both would mean ingesting a paper under a made-up identity, and the
 * identity check downstream compares against the manifest -- so a fabricated
 * one would be comparing the paper to fiction.
 */
export function buildExamPaperManifest(input: {
  candidate: ExamPaperCandidate;
  course: ExamCatalogueCourse;
  rightsKey: string;
  rightsVersion: number;
  now?: number;
}): ExamPaperManifestDraft | null {
  const now = input.now ?? Date.now();
  const year = readExamPaperYear(input.candidate.label, now);
  const series = readExamPaperSeries(input.candidate.label);
  const studyLevel = examStudyLevelForQualification(input.course.qualification);
  if (!year || !series || !studyLevel) return null;
  return {
    board: input.course.board,
    boardLabel: input.course.boardLabel,
    qualification: input.course.qualification,
    specificationId: input.course.specificationCode,
    specificationTitle: input.course.specificationTitle,
    specificationVersion: "1",
    subject: input.course.subject,
    studyLevel,
    componentCode: input.course.componentCode,
    componentTitle: input.course.componentTitle,
    year,
    series,
    paperReference: readExamPaperReference(input.candidate.label, input.course),
    // A past paper is servable from the moment it is ingested; the window is
    // there for material that is announced but not yet in force.
    activeFrom: now,
    questionPaperUrl: input.candidate.questionPaperUrl,
    markSchemeUrl: input.candidate.markSchemeUrl,
    rightsKey: input.rightsKey,
    rightsVersion: input.rightsVersion,
  };
}
