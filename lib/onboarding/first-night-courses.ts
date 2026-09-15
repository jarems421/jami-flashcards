import {
  resolveExamCourseDraft,
  type ExamCourseOption,
} from "@/lib/practice/exam-course-form";
import { examCourseLabels, examSubjectFromTitle } from "@/lib/practice/exam-course-names";
import type { ExamBoardId, ExamQualification } from "@/lib/practice/exam-formats";
import type { ExamCourseSelection } from "@/lib/practice/exam-questions";
import type { StudyLevel } from "@/lib/profile/study-level";

/**
 * Which exam course a First night answer is, so the folder it makes can draw
 * real questions straight away.
 *
 * "GCSE, Maths, AQA" is nearly a course but not quite: AQA runs Maths at two
 * tiers, and a GCSE biologist may be sitting Biology on its own or Combined
 * Science. Guessing either wrong serves the wrong questions, so the welcome
 * asks the one extra question only when the catalogue says there is a choice,
 * and "Not sure yet" leaves the course for Practice to ask about later.
 */

/** The boards the welcome offers, by the name students know them by. */
export const FIRST_NIGHT_BOARD_IDS: Record<string, ExamBoardId> = {
  AQA: "aqa",
  Edexcel: "pearson_edexcel",
  OCR: "ocr",
};

export const FIRST_NIGHT_LEVELS: Record<string, { studyLevel: StudyLevel | null; qualification: ExamQualification | null }> = {
  GCSE: { studyLevel: "gcse-equivalent", qualification: "gcse" },
  "A level": { studyLevel: "post-16-equivalent", qualification: "a_level" },
  // IB runs its own exams, so none of the boards above apply.
  IB: { studyLevel: "post-16-equivalent", qualification: null },
  University: { studyLevel: "undergraduate", qualification: null },
  "Something else": { studyLevel: null, qualification: null },
};

/** Whether a level is one the exam boards examine, and so worth asking a board for. */
export function firstNightLevelHasBoards(level: string | null) {
  return Boolean(level && FIRST_NIGHT_LEVELS[level]?.qualification);
}

export type FirstNightCourseChoice = {
  specificationId: string;
  label: string;
  tiers: string[];
};

const IGNORED = new Set(["and", "the", "for", "with", "gcse", "level", "course", "studies", "study"]);
const SCIENCES = new Set(["biology", "chemistry", "physics", "science", "combined science"]);

function words(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3 && !IGNORED.has(word));
}

/** "maths" and "Mathematics", "comp" and "Computing": one subject, spelt as people spell it. */
function sameWord(left: string, right: string) {
  const length = Math.min(4, left.length, right.length);
  return left.slice(0, length) === right.slice(0, length);
}

function matchScore(subject: string, course: ExamCourseOption) {
  const title = words(examSubjectFromTitle(course.specificationTitle) || course.specificationTitle);
  return words(subject).filter((word) => title.some((titleWord) => sameWord(word, titleWord))).length;
}

/**
 * The courses a subject could be at a level, best match first.
 *
 * Only the closest matches are kept, so "English Literature" is not offered
 * English Language. A science also offers Combined Science, because that is
 * how most GCSE students sit it and they rarely call it that when asked what
 * they study.
 */
export function firstNightCourseChoices(
  courses: readonly ExamCourseOption[],
  level: string | null,
  subject: string
): FirstNightCourseChoice[] {
  const qualification = level ? FIRST_NIGHT_LEVELS[level]?.qualification : null;
  if (!qualification) return [];
  const atLevel = courses.filter((course) => course.qualification === qualification);

  const scored = atLevel.map((course) => ({ course, score: matchScore(subject, course) }));
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  const matches = best > 0 ? scored.filter((entry) => entry.score === best).map((entry) => entry.course) : [];

  const combined = SCIENCES.has(subject.trim().toLowerCase())
    ? atLevel.filter((course) => /\bcombined science\b/i.test(course.specificationTitle) && !matches.includes(course))
    : [];

  const chosen = [...matches, ...combined];
  const labels = examCourseLabels(chosen);
  return chosen.map((course) => ({
    specificationId: course.specificationId,
    label: labels.get(course.specificationId) ?? course.specificationTitle,
    tiers: course.tiers.map((tier) => tier.name),
  }));
}

/**
 * The course to save on the folder, or null when it is not settled.
 *
 * A course with tiers and no tier picked is not settled: saving it would draw
 * questions from both, which is the mistake the tier question exists to stop.
 */
export function firstNightExamCourse(input: {
  courses: readonly ExamCourseOption[];
  board: string | null | undefined;
  specificationId: string | null | undefined;
  tier?: string | null;
}): ExamCourseSelection | null {
  const board = input.board ? FIRST_NIGHT_BOARD_IDS[input.board] : undefined;
  if (!board || !input.specificationId) return null;
  const resolved = resolveExamCourseDraft(
    { board, specificationId: input.specificationId, tier: input.tier ?? "" },
    input.courses
  );
  return resolved.status === "ready" ? resolved.course : null;
}
