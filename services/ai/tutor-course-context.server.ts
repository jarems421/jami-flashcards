import "server-only";

import { randomUUID } from "node:crypto";
import type { Source } from "@/lib/material/sources";
import {
  buildTutorCourseContext,
  isCourseDocumentTitle,
  type TutorCourse,
} from "@/lib/ai/tutor-course-context";
import { describeExamCourse } from "@/lib/practice/exam-course-form";
import { examSubjectFromTitle } from "@/lib/practice/exam-course-names";
import { EXAM_BOARD_LABELS, EXAM_QUALIFICATION_LABELS } from "@/lib/practice/exam-formats";
import { servableExamSpecificationTopics } from "@/lib/practice/exam-specification-topics";
import type { QuestionTypeRule } from "@/lib/practice/question-types";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";
import { createLogger } from "@/lib/observability/logger";
import { getAdminDb } from "@/services/firebase/admin";
import { loadQuestionTypeRules } from "@/services/practice/question-type-rules.server";

const log = createLogger({ module: "ai.assistant.course_context" });

/** An enrichment, like the learner profile: past this, Tutor answers without it. */
const COURSE_CONTEXT_BUDGET_MS = 2_500;

type LoadedCourse = {
  course: TutorCourse;
  specificationTopics: string[];
  rules: QuestionTypeRule[];
};

/**
 * The verified course behind the folder a question sits in, with its topic
 * headings and its examiners' question-type rules.
 *
 * One folder only, as with folder instructions and the learner profile: work
 * filed in two folders could be on two courses, and choosing one would be a
 * guess. Never throws and never waits past its budget.
 */
export async function loadTutorCourse(input: {
  uid: string;
  folderIds: readonly string[];
}): Promise<LoadedCourse | undefined> {
  const folderIds = Array.from(new Set(input.folderIds.filter(Boolean)));
  if (folderIds.length !== 1) return undefined;
  const startedAt = Date.now();

  const work = (async (): Promise<LoadedCourse | undefined> => {
    const snapshot = await getAdminDb()
      .collection("users")
      .doc(input.uid)
      .collection("studyFolders")
      .doc(folderIds[0])
      .get();
    if (!snapshot.exists) return undefined;
    const folder = mapStudyFolderData(snapshot.id, snapshot.data() as Record<string, unknown>);
    const course = folder.examCourse;
    if (!course) return undefined;
    const qualification = EXAM_QUALIFICATION_LABELS[course.qualification] ?? course.qualification;
    const subject = examSubjectFromTitle(course.specificationTitle) || course.specificationTitle;
    const rules = await loadQuestionTypeRules({
      awardingBodyOrInstitution: EXAM_BOARD_LABELS[course.board] ?? course.board,
      qualificationOrModule: `${qualification} ${subject}`,
      studyLevel: qualification,
    });
    return {
      course: { label: describeExamCourse(course) },
      specificationTopics:
        servableExamSpecificationTopics(course.specificationId)?.topics.map((topic) => topic.label) ?? [],
      rules,
    };
  })();
  work.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const loaded = await Promise.race([
      work,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), COURSE_CONTEXT_BUDGET_MS);
      }),
    ]);
    if (loaded === "timeout") {
      log.warn("course_context.timed_out", { budgetMs: COURSE_CONTEXT_BUDGET_MS });
      return undefined;
    }
    log.info("course_context.completed", {
      outcome: loaded ? "course" : "no_course",
      ruleCount: loaded?.rules.length ?? 0,
      topicCount: loaded?.specificationTopics.length ?? 0,
      latencyMs: Date.now() - startedAt,
    });
    return loaded;
  } catch (error) {
    log.warn("course_context.failed", { error });
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Sources that define the course rather than teach it, for students whose
 * course Jami does not catalogue. Only indexed ones: those are searched for the
 * passages that bear on the question, where an unindexed one would be read
 * whole and crowd out everything else.
 */
export function findCourseDocumentSources(sources: readonly Source[]) {
  return sources.filter(
    (source) => source.indexStatus === "ready" && isCourseDocumentTitle(source.title)
  );
}

export function buildTutorCourseContextFor(input: {
  loaded: LoadedCourse | undefined;
  courseDocuments: readonly Source[];
  currentText: string;
}) {
  return buildTutorCourseContext({
    ...(input.loaded
      ? {
          course: input.loaded.course,
          specificationTopics: input.loaded.specificationTopics,
          rules: input.loaded.rules,
        }
      : {}),
    courseDocuments: input.courseDocuments.map((source) => ({ title: source.title })),
    currentText: input.currentText,
    boundaryToken: randomUUID(),
  });
}
