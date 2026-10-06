"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { examStudyLevelForQualification } from "@/lib/practice/exam-ingestion-manifest";
import type { ExamCourseSelection } from "@/lib/practice/exam-questions";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getActiveStudyFolders, updateStudyFolder } from "@/services/study/folders";

/**
 * The study folders a practice paper can be kept in, and which one is chosen.
 *
 * Opens on the folder named in the link (`?folder=`), or the first folder.
 */
export function usePracticePaperFolders(
  userId: string,
  onError: (error: unknown, fallback: string) => void
) {
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getActiveStudyFolders(userId)
      .then((items) => {
        if (!active) return;
        setFolders(items);
        const requested = new URLSearchParams(window.location.search).get("folder") ?? "";
        setFolderId(items.find((folder) => folder.id === requested)?.id ?? items[0]?.id ?? "");
      })
      .catch((error) => {
        if (active) onError(error, "Could not load your folders.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onError, userId]);

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === folderId) ?? null,
    [folderId, folders]
  );

  /**
   * Keeps a course picked for a folder that had none on the folder, so the
   * next paper and Practice questions start from it. A course is only kept on
   * a folder with a school level, so one is set with it where missing.
   *
   * Remembering is a convenience: a failure is logged, never shown, and the
   * paper does not wait on it.
   */
  const rememberCourse = useCallback(
    async (folder: StudyFolder, course: ExamCourseSelection) => {
      const studyLevel = folder.studyLevel ?? examStudyLevelForQualification(course.qualification);
      try {
        await updateStudyFolder(userId, folder.id, { examCourse: course, studyLevel });
        setFolders((current) =>
          current.map((item) => (item.id === folder.id ? { ...item, examCourse: course, studyLevel } : item))
        );
      } catch (error) {
        console.warn("Could not save the folder's course.", error);
      }
    },
    [userId]
  );

  return { folders, folderId, setFolderId, selectedFolder, loading, rememberCourse };
}
