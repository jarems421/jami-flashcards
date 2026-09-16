import {
  EXAM_BOARD_LABELS,
  isExamQualification,
  type ExamBoardId,
} from "@/lib/practice/exam-formats";
import { examCourseName } from "@/lib/practice/exam-course-names";
import { examStudyLevelForQualification } from "@/lib/practice/exam-ingestion-manifest";
import { filterCanonicalSetTextIds } from "@/lib/practice/exam-set-texts";
import {
  buildExamCourseSelection,
  type ExamCourseSelection,
} from "@/lib/practice/exam-questions";
import type { StudyLevel } from "@/lib/profile/study-level";

/** One course a board runs, as the course catalogue returns it. */
export type ExamCourseOption = {
  specificationId: string;
  specificationTitle: string;
  qualification: string;
  qualificationLabel: string;
  componentIds: string[];
  tiers: Array<{ name: string; componentIds: string[] }>;
};

/**
 * What has been picked so far, which is not yet a course.
 *
 * Three strings rather than an `ExamCourseSelection`, because a selection needs
 * the qualification, title and papers that only the catalogue knows -- and a
 * form has to hold a half-made choice while that catalogue loads.
 */
export type ExamCourseDraft = {
  board: ExamBoardId | "";
  specificationId: string;
  tier: string;
  /**
   * The set texts this student studies, where the course sets any.
   *
   * Optional because a half-made draft predates the question being asked, and
   * most courses never ask it.
   */
  setTextIds?: string[];
};

export const EMPTY_EXAM_COURSE_DRAFT: ExamCourseDraft = {
  board: "",
  specificationId: "",
  tier: "",
  setTextIds: [],
};

export function examCourseDraftFrom(
  course: ExamCourseSelection | null | undefined
): ExamCourseDraft {
  if (!course) return EMPTY_EXAM_COURSE_DRAFT;
  return {
    board: course.board,
    specificationId: course.specificationId,
    tier: course.tier ?? "",
    setTextIds: course.setTextIds ?? [],
  };
}

export type ResolvedExamCourse =
  | { status: "none"; course: null }
  | { status: "needs_tier"; course: null }
  | { status: "ready"; course: ExamCourseSelection };

export const NO_EXAM_COURSE: ResolvedExamCourse = { status: "none", course: null };

/**
 * Turns a draft into the course that will be saved, or says why it cannot.
 *
 * A saved course the draft has not changed is kept exactly as it was, even
 * while the catalogue is loading, after it stops listing the course, or after
 * it splits the course into tiers. Renaming a folder must not quietly drop or
 * rewrite the course it practises.
 */
export function resolveExamCourseDraft(
  draft: ExamCourseDraft,
  courses: readonly ExamCourseOption[],
  saved?: ExamCourseSelection | null
): ResolvedExamCourse {
  if (!draft.board || !draft.specificationId) return NO_EXAM_COURSE;
  const sameTexts = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && left.every((id, index) => id === right[index]);
  const keepSaved: ResolvedExamCourse | null =
    saved &&
    saved.board === draft.board &&
    saved.specificationId === draft.specificationId &&
    (saved.tier ?? "") === draft.tier &&
    sameTexts(saved.setTextIds ?? [], draft.setTextIds ?? [])
      ? { status: "ready", course: saved }
      : null;

  const option = courses.find(
    (course) => course.specificationId === draft.specificationId
  );
  if (!option || !isExamQualification(option.qualification)) {
    return keepSaved ?? NO_EXAM_COURSE;
  }

  const tier = option.tiers.find((item) => item.name === draft.tier);
  if (option.tiers.length > 0 && !tier) {
    return keepSaved ?? { status: "needs_tier", course: null };
  }

  return {
    status: "ready",
    course: buildExamCourseSelection({
      board: draft.board,
      qualification: option.qualification,
      specificationId: option.specificationId,
      specificationTitle: option.specificationTitle,
      tier: tier?.name,
      /*
       * The tier's own papers where the catalogue maps them, so a Higher
       * student is never drawn a Foundation question. Every component of the
       * course otherwise.
       */
      componentIds: tier?.componentIds.length
        ? tier.componentIds
        : option.componentIds,
      /*
       * Only texts this specification actually sets. A student keeps what they
       * chose, and an id from a course they have since changed is dropped
       * rather than quietly filtering every question out.
       */
      setTextIds: filterCanonicalSetTextIds(option.specificationId, draft.setTextIds ?? []).setTextIds,
    }),
  };
}

/** Words in a folder name that say nothing about which subject it is. */
const IGNORED_SUBJECT_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "gcse",
  "igcse",
  "level",
  "course",
  "exam",
  "exams",
  "paper",
  "papers",
  "revision",
  "notes",
  "year",
]);

function subjectWords(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3 && !IGNORED_SUBJECT_WORDS.has(word));
}

/** "maths" and "Mathematics", "bio" and "Biology": one subject, spelt as people spell it. */
function sameSubjectWord(left: string, right: string) {
  const length = Math.min(4, left.length, right.length);
  return left.slice(0, length) === right.slice(0, length);
}

/**
 * A board's courses in the order a student is most likely to want them.
 *
 * A GCSE folder is not offered A-level courses, and a folder called "Maths"
 * finds Mathematics at the top instead of somewhere in a list of forty. Both
 * only reorder or narrow: early secondary is not narrowed, because a student
 * below GCSE practising towards it is exactly who picks that level, and a level
 * that would leave nothing shows everything rather than an empty list.
 */
export function arrangeExamCourseOptions(
  courses: readonly ExamCourseOption[],
  context: { studyLevel?: StudyLevel | ""; subjectHint?: string } = {}
) {
  const { studyLevel, subjectHint = "" } = context;
  const atLevel =
    studyLevel === "gcse-equivalent" || studyLevel === "post-16-equivalent"
      ? courses.filter(
          (course) =>
            isExamQualification(course.qualification) &&
            examStudyLevelForQualification(course.qualification) === studyLevel
        )
      : [];
  const pool = atLevel.length > 0 ? atLevel : [...courses];
  const hint = subjectWords(subjectHint);
  if (hint.length === 0) return { suggested: [], others: pool };

  const suggested = pool.filter((course) =>
    subjectWords(course.specificationTitle).some((word) =>
      hint.some((hintWord) => sameSubjectWord(word, hintWord))
    )
  );
  return {
    suggested,
    others: pool.filter((course) => !suggested.includes(course)),
  };
}

/** "AQA · GCSE Maths · Higher" */
export function describeExamCourse(course: ExamCourseSelection) {
  return [
    EXAM_BOARD_LABELS[course.board] ?? course.board,
    examCourseName(course),
    course.tier,
  ]
    .filter(Boolean)
    .join(" · ");
}
