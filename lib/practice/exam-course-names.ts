import {
  EXAM_BOARD_LABELS,
  EXAM_QUALIFICATION_LABELS,
  isExamQualification,
} from "@/lib/practice/exam-formats";

/**
 * A course named the way a student says it: "GCSE Maths", "A level Biology".
 *
 * Catalogue titles are written by the boards and by the tooling that reads
 * them, so the same course arrives as "GCSE Mathematics", "Pearson Edexcel
 * Level 1/Level 2 GCSE in Mathematics (1MA1)" or "GCSE Biology (8461)". The
 * picker put the qualification in front of that and the code after it, and
 * students were shown "GCSE GCSE Mathematics (8300)".
 */

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Words that name who sets or awards a course rather than what it is. */
const NOISE_WORDS = [
  ...Object.values(EXAM_BOARD_LABELS),
  "Pearson",
  "Edexcel",
  "Level 1/Level 2",
  "Level 1 / Level 2",
  "Level 3",
  "International Advanced Subsidiary",
  "International Advanced Level",
  "International A level",
  "International A-level",
  "International GCSE",
  "AS and A level",
  "AS and A-level",
  "AS/A level",
  "AS/A-level",
  "Advanced Subsidiary",
  "Advanced Level",
  "A level",
  "A-level",
  "AS level",
  "AS-level",
  "GCE",
  "GCSE",
  "IGCSE",
  "National 5",
  "IB Diploma",
  "IB MYP",
  "9-1",
];

const NOISE = new RegExp(
  `(^|\\s)(?:${[...new Set(NOISE_WORDS)]
    .sort((left, right) => right.length - left.length)
    .map(escapePattern)
    .join("|")})(?=\\s|$|[:,])`,
  "gi"
);

/**
 * The subject a catalogue title is about, with the board, qualification and
 * code taken off: "Pearson Edexcel GCSE in Mathematics (1MA1)" is "Mathematics".
 * Empty when the title was nothing but those.
 */
export function examSubjectFromTitle(title: string) {
  return title
    .replace(/\([^)]*\)/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,–-]*(?:in\s+)?/i, "")
    .replace(/[\s:,–-]+$/, "")
    .trim();
}

export function examCourseName(course: {
  qualification: string;
  specificationTitle: string;
}) {
  const qualification = isExamQualification(course.qualification)
    ? EXAM_QUALIFICATION_LABELS[course.qualification]
    : "";
  const subject =
    examSubjectFromTitle(course.specificationTitle) ||
    course.specificationTitle.trim();
  return [qualification, subject.replace(/\bmathematics\b/gi, "Maths")]
    .filter(Boolean)
    .join(" ");
}

/**
 * Every course's name, keyed by specification.
 *
 * The code comes back only where two courses would otherwise read the same,
 * because a choice between two identical labels is not a choice.
 */
export function examCourseLabels(
  courses: readonly {
    specificationId: string;
    qualification: string;
    specificationTitle: string;
  }[]
) {
  const names = new Map(
    courses.map((course) => [course.specificationId, examCourseName(course)])
  );
  const counts = new Map<string, number>();
  for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Map(
    [...names].map(([specificationId, name]) => [
      specificationId,
      (counts.get(name) ?? 0) > 1 ? `${name} (${specificationId})` : name,
    ])
  );
}
