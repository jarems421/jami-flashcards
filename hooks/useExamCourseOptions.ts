"use client";

import { useEffect, useState } from "react";
import type { ExamCourseOption } from "@/lib/practice/exam-course-form";
import type { ExamBoardId } from "@/lib/practice/exam-formats";
import { getExamCourseOptions } from "@/services/study/exam-practice";

export type ExamCourseOptionsState = {
  courses: readonly ExamCourseOption[];
  loading: boolean;
  failed: boolean;
  retry: () => void;
};

const NO_COURSES: readonly ExamCourseOption[] = [];

/**
 * The courses a board runs, fetched once a board is chosen.
 *
 * The result is kept against the board (and attempt) it was fetched for, so
 * switching boards reads as loading straight away instead of briefly offering
 * the previous board's courses under the new board's name.
 */
export function useExamCourseOptions(
  board: ExamBoardId | ""
): ExamCourseOptionsState {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    courses: readonly ExamCourseOption[];
    failed: boolean;
  } | null>(null);
  const key = board ? `${board}:${attempt}` : "";

  useEffect(() => {
    if (!board) return;
    let active = true;
    const requestKey = `${board}:${attempt}`;
    getExamCourseOptions({ board })
      .then((courses) => {
        if (active) setResult({ key: requestKey, courses, failed: false });
      })
      .catch(() => {
        if (active) {
          setResult({ key: requestKey, courses: NO_COURSES, failed: true });
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, board]);

  const current = key && result?.key === key ? result : null;
  return {
    courses: current?.courses ?? NO_COURSES,
    loading: Boolean(board) && current === null,
    failed: current?.failed ?? false,
    retry: () => setAttempt((value) => value + 1),
  };
}
