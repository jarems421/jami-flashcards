import { normalizeTutorGuidanceText } from "@/lib/ai/tutor-personalisation";

/**
 * The courses a student is actually taking.
 *
 * A study level stops describing anybody once it reaches sixth form: "A level"
 * covers Further Maths and Fine Art, and "University" covers more than that
 * again. So from those levels up the student names their subjects, and the
 * tutor knows whether "differentiate" means calculus or cell biology before it
 * has to guess from a half-typed question.
 *
 * Stored as a plain list of short strings on the user document. It is not a
 * taxonomy and deliberately does not validate against one: a student writing
 * "IB HL Physics" or "Access to Nursing" has told Jami something true, and a
 * dropdown of approved subjects would have thrown it away.
 */

export const MAX_STUDY_SUBJECTS = 10;
export const MAX_STUDY_SUBJECT_LENGTH = 60;

/**
 * One subject, cleaned.
 *
 * Shares the guidance-text cleaner with everything else a student writes that
 * reaches a prompt -- control characters mean nothing in a subject name and are
 * a cheap way to hide text from the person who typed it -- and then flattens
 * the result to a single line, because this is a chip and not a document.
 */
export function normalizeStudySubject(value: unknown) {
  return normalizeTutorGuidanceText(value, MAX_STUDY_SUBJECT_LENGTH)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A stored or submitted list, cleaned, de-duplicated and capped.
 *
 * Duplicates are matched case-insensitively so "maths" typed twice does not
 * become two lines of the prompt, but the first spelling is what is kept --
 * the student's own capitalisation is theirs.
 */
export function normalizeStudySubjects(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const subjects: string[] = [];
  for (const entry of value) {
    const subject = normalizeStudySubject(entry);
    if (!subject) continue;
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    subjects.push(subject);
    if (subjects.length >= MAX_STUDY_SUBJECTS) break;
  }
  return subjects;
}

/** "Maths, Physics and Chemistry", for a sentence rather than a list. */
export function formatStudySubjects(subjects: readonly string[]) {
  if (subjects.length === 0) return "";
  if (subjects.length === 1) return subjects[0];
  return `${subjects.slice(0, -1).join(", ")} and ${subjects[subjects.length - 1]}`;
}
