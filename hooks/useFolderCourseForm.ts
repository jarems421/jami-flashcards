"use client";

import { useState } from "react";
import { useExamCourseOptions } from "@/hooks/useExamCourseOptions";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  NO_EXAM_COURSE,
  examCourseDraftFrom,
  resolveExamCourseDraft,
  type ExamCourseDraft,
} from "@/lib/practice/exam-course-form";
import {
  examBoardAppliesTo,
  type ExamCourseSelection,
} from "@/lib/practice/exam-questions";
import type { StudyLevel } from "@/lib/profile/study-level";

/**
 * A folder's study level and exam course, as one piece of form state.
 *
 * Creating a folder and editing one ask the same two questions, and the course
 * only means anything at a school level -- so both forms hold them here rather
 * than each deciding when a course applies and what it resolves to.
 */
export function useFolderCourseForm(initial: {
  studyLevel?: StudyLevel;
  examCourse?: ExamCourseSelection;
}) {
  const [studyLevel, setStudyLevel] = useState<StudyLevel | "">(
    initial.studyLevel ?? ""
  );
  const [courseDraft, setCourseDraft] = useState<ExamCourseDraft>(() =>
    examCourseDraftFrom(initial.examCourse)
  );

  const levelTakesCourse = examBoardAppliesTo(studyLevel || null);
  const courseApplies = featureFlags.enablePastPaperPractice && levelTakesCourse;
  const courseOptions = useExamCourseOptions(
    courseApplies ? courseDraft.board : ""
  );
  const resolvedCourse = courseApplies
    ? resolveExamCourseDraft(courseDraft, courseOptions.courses, initial.examCourse)
    : NO_EXAM_COURSE;

  return {
    studyLevel,
    setStudyLevel,
    courseDraft,
    setCourseDraft,
    /** The level is one an exam board runs courses for. */
    levelTakesCourse,
    /** The course fields are shown and saved. */
    courseApplies,
    courseOptions,
    resolvedCourse,
    savedCourse: initial.examCourse,
    reset: () => {
      setStudyLevel(initial.studyLevel ?? "");
      setCourseDraft(examCourseDraftFrom(initial.examCourse));
    },
  };
}

export type FolderCourseForm = ReturnType<typeof useFolderCourseForm>;
