import { describeExamCourse } from "@/lib/practice/exam-course-form";
import type { StudyLevel } from "@/lib/profile/study-level";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";

export type TutorFolderFacts = {
  name: string;
  subject: string | null;
  studyLevel: StudyLevel | null;
  /** "AQA · A level Biology", when the folder was given an exam course. */
  course: string | null;
  /** The stored notes text, as it is on the folder document. */
  tutorInstructions: string;
};

/**
 * What a folder already says about its subject, read the way the rest of the
 * app reads a folder.
 *
 * Through `mapStudyFolderData` rather than straight off the document, so the
 * course only counts when the folder's level is one an exam board applies to --
 * the same rule the folder page uses when it decides whether to show one.
 */
export function readTutorFolderFacts(
  id: string,
  data: Record<string, unknown>
): TutorFolderFacts {
  const folder = mapStudyFolderData(id, data);
  return {
    name: folder.name,
    subject: folder.subject ?? null,
    studyLevel: folder.studyLevel ?? null,
    course: folder.examCourse ? describeExamCourse(folder.examCourse) : null,
    tutorInstructions: folder.tutorInstructions,
  };
}
