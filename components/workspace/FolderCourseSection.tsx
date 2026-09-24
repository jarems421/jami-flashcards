"use client";

import ExamCourseFields from "@/components/practice/ExamCourseFields";
import StudyLevelSelect from "@/components/study/StudyLevelSelect";
import FormDisclosure from "@/components/ui/FormDisclosure";
import type { FolderCourseForm } from "@/hooks/useFolderCourseForm";
import { featureFlags } from "@/lib/app/feature-flags";
import { describeExamCourse } from "@/lib/practice/exam-course-form";
import { getStudyLevelShortLabel } from "@/lib/profile/study-level";

type FolderCourseSectionProps = {
  form: FolderCourseForm;
  /** The folder's name and subject, used to suggest likely courses. */
  subjectHint: string;
  disabled?: boolean;
};

/**
 * A folder's level and exam course, asked where the folder is made.
 *
 * These used to exist only in the folder editor, so every new folder was
 * created, reopened and edited before Past Paper Practice would even list it.
 *
 * Folded away unless something is already set: most folders never need it,
 * and the summary says what is chosen without opening it.
 */
export default function FolderCourseSection({
  form,
  subjectHint,
  disabled = false,
}: FolderCourseSectionProps) {
  const practice = featureFlags.enablePastPaperPractice;
  const course = form.resolvedCourse.course;
  const summary = course
    ? describeExamCourse(course)
    : form.studyLevel
      ? getStudyLevelShortLabel(form.studyLevel)
      : "Optional";

  return (
    <FormDisclosure
      title="Level and course"
      summary={summary}
      defaultOpen={Boolean(form.studyLevel)}
    >
      <p className="-mt-1 mb-4 max-w-xl text-xs leading-5 text-text-muted">
        {practice
          ? "Sets how Jami explains things here, and which past-paper questions Practice uses."
          : "Sets how Jami explains things inside this folder."}
      </p>
      <div className="grid gap-4">
        <StudyLevelSelect
          value={form.studyLevel}
          emptyLabel="Use my account level"
          description={
            practice && !form.studyLevel
              ? "Choose School, GCSE or A level to add your exam board and course."
              : undefined
          }
          disabled={disabled}
          onChange={form.setStudyLevel}
        />

        {form.courseApplies ? (
          <div className="grid gap-4 border-t border-[var(--color-border)] pt-4">
            <ExamCourseFields
              value={form.courseDraft}
              onChange={form.setCourseDraft}
              options={form.courseOptions}
              studyLevel={form.studyLevel}
              subjectHint={subjectHint}
              savedCourse={form.savedCourse}
              disabled={disabled}
            />
            {course ? (
              <p
                role="status"
                className="flex items-start gap-2.5 rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-3 text-sm leading-5 text-text-secondary"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-accent"
                >
                  <path
                    d="m5 10.5 3.2 3L15 6.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>
                  Practice will use{" "}
                  <span className="font-semibold text-text-primary">
                    {describeExamCourse(course)}
                  </span>
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </FormDisclosure>
  );
}
