"use client";

import { useState } from "react";
import { useExamCourseOptions } from "@/hooks/useExamCourseOptions";
import {
  examCourseDraftFrom,
  resolveExamCourseDraft,
  type ExamCourseDraft,
} from "@/lib/practice/exam-course-form";
import { sameExamTier } from "@/lib/practice/exam-course-tiers";
import { examBoardAppliesTo } from "@/lib/practice/exam-questions";
import { servableExamSpecificationTopics } from "@/lib/practice/exam-specification-topics";
import { wholeCourseSelection, type PaperTopicSelection } from "@/lib/practice/paper-topic-scope";
import type { DescribedExamKind, DescribedExamLength } from "@/lib/practice/practice-paper-request";
import type { StudyFolder } from "@/lib/workspace/study-folders";

/**
 * Which exam a generated paper is for.
 *
 * A school course is picked, not described: that is every folder except one
 * marked university or professional. Most folders were made before a level
 * was asked for and have none, and asking them for a course is right. For a
 * picked course the student chooses the paper and the topics it covers.
 *
 * Anything else -- a university module or a professional exam -- is described
 * by the student: the module, the kind of exam, how long it is and what is on
 * it.
 *
 * The course, paper, topics and module are each held against what they were
 * chosen for, so changing folder or course starts from that folder's or
 * course's own defaults rather than carrying over a choice that no longer
 * applies.
 */
export function usePracticePaperExam({
  folderId,
  folder,
  generating,
}: {
  folderId: string;
  folder: StudyFolder | null;
  /** The paper is being generated, rather than uploaded. */
  generating: boolean;
}) {
  const [courseState, setCourseState] = useState<{ folderId: string; draft: ExamCourseDraft } | null>(null);
  const [paperState, setPaperState] = useState<{ specificationId: string; code: string } | null>(null);
  const [topicState, setTopicState] = useState<{ specificationId: string; selection: PaperTopicSelection } | null>(
    null
  );
  const [moduleState, setModuleState] = useState<{ folderId: string; name: string } | null>(null);
  const [kind, setKind] = useState<DescribedExamKind>("final");
  const [length, setLength] = useState<DescribedExamLength>("unsure");
  const [examined, setExamined] = useState("");

  const schoolFolder = Boolean(folder && (!folder.studyLevel || examBoardAppliesTo(folder.studyLevel)));
  const courseDraft = courseState?.folderId === folderId ? courseState.draft : examCourseDraftFrom(folder?.examCourse);
  const courseOptions = useExamCourseOptions(schoolFolder ? courseDraft.board : "");
  const resolvedCourse = resolveExamCourseDraft(courseDraft, courseOptions.courses, folder?.examCourse);
  /** The picked school course, which is the request when there is one. */
  const course = generating && schoolFolder ? resolvedCourse.course : null;
  const courseOption = courseOptions.courses.find((option) => option.specificationId === courseDraft.specificationId);
  const paperChoices = (courseOption?.papers ?? []).filter(
    (paper) => !course?.tier || !paper.tier || sameExamTier(paper.tier, course.tier)
  );
  const paperCode = paperState && paperState.specificationId === course?.specificationId ? paperState.code : "";
  const chosenPaper = paperChoices.find((paper) => paper.code === paperCode) ?? paperChoices[0];
  const topicSelection: PaperTopicSelection = course
    ? topicState?.specificationId === course.specificationId
      ? topicState.selection
      : wholeCourseSelection(course.specificationId)
    : { topicIds: [], conceptIds: [] };
  // Filled in from the folder, which is usually named after the module.
  const moduleName = moduleState?.folderId === folderId ? moduleState.name : folder?.subject || folder?.name || "";

  return {
    schoolFolder,
    /** A paper for a course with no board catalogue, described by the student. */
    described: generating && !schoolFolder,
    courseDraft,
    setCourseDraft: (draft: ExamCourseDraft) => setCourseState({ folderId, draft }),
    courseOptions,
    course,
    paperChoices,
    chosenPaper,
    choosePaper: (code: string) => {
      if (course) setPaperState({ specificationId: course.specificationId, code });
    },
    topicSelection,
    setTopicSelection: (selection: PaperTopicSelection) => {
      if (course) setTopicState({ specificationId: course.specificationId, selection });
    },
    /** The picked course has a checked topic list, so the paper must cover at least one topic. */
    topicsRequired: Boolean(course && servableExamSpecificationTopics(course.specificationId)?.topics.length),
    moduleName,
    setModuleName: (name: string) => setModuleState({ folderId, name }),
    kind,
    setKind,
    length,
    setLength,
    examined,
    setExamined,
  };
}

export type PracticePaperExam = ReturnType<typeof usePracticePaperExam>;
