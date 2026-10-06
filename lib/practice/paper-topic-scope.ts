import { buildExamCourseSelection, type ExamCourseSelection } from "@/lib/practice/exam-questions";
import { isExamBoardId, isExamQualification } from "@/lib/practice/exam-formats";
import {
  filterCanonicalTopicIds,
  servableExamSpecificationTopics,
} from "@/lib/practice/exam-specification-topics";
import {
  filterCanonicalConceptIds,
  servableExamSpecificationConcepts,
} from "@/lib/practice/exam-specification-concepts";

/**
 * Which course, which paper and which parts of the course a Jami paper covers.
 *
 * A student picks these instead of describing them: the course from the
 * board's own catalogue, the paper from that course's papers, and the topics
 * from the course's checked topic list. Leaving a topic out is how a student
 * says they are already strong on it. Every id is checked against the
 * catalogue here, so nothing a page sends can name a topic the course lacks.
 */
export type PaperTopicScope = {
  course: ExamCourseSelection;
  /** The paper (component) to sit, when the student chose one. */
  paper?: { code: string; title: string };
  /** Whole topics included; empty with no concepts means the whole course. */
  topicIds: string[];
  /** Single concepts included from topics that are not included whole. */
  conceptIds: string[];
};

/** What a student has ticked in the topic picker, before it becomes a scope. */
export type PaperTopicSelection = {
  /** Whole topics in the paper. */
  topicIds: string[];
  /** Single subtopics chosen inside topics that are not in whole. */
  conceptIds: string[];
};

/** Every topic of the course, which is what a new paper starts with. */
export function wholeCourseSelection(specificationId: string): PaperTopicSelection {
  return {
    topicIds: (servableExamSpecificationTopics(specificationId)?.topics ?? []).map((topic) => topic.id),
    conceptIds: [],
  };
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export function readPaperTopicScope(value: unknown): PaperTopicScope | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const raw = input.course && typeof input.course === "object" ? (input.course as Record<string, unknown>) : null;
  if (!raw || !isExamBoardId(raw.board) || !isExamQualification(raw.qualification)) return null;
  const specificationId = text(raw.specificationId, 160);
  const specificationTitle = text(raw.specificationTitle, 240);
  if (!specificationId || !specificationTitle) return null;
  const course = buildExamCourseSelection({
    board: raw.board,
    qualification: raw.qualification,
    specificationId,
    specificationTitle,
    tier: text(raw.tier, 120) || undefined,
    componentIds: Array.isArray(raw.componentIds)
      ? raw.componentIds.flatMap((id) => (typeof id === "string" && id.trim() ? [id.trim().slice(0, 160)] : [])).slice(0, 20)
      : [],
  });
  const paperInput = input.paper && typeof input.paper === "object" ? (input.paper as Record<string, unknown>) : null;
  const paperCode = text(paperInput?.code, 80);
  const paperTitle = text(paperInput?.title, 160);
  const ids = (key: string) =>
    Array.isArray(input[key]) ? (input[key] as unknown[]).filter((id): id is string => typeof id === "string").slice(0, 200) : [];
  const { topicIds } = filterCanonicalTopicIds(specificationId, ids("topicIds"));
  const { conceptIds } = filterCanonicalConceptIds(specificationId, ids("conceptIds"));
  return {
    course,
    ...(paperCode || paperTitle ? { paper: { code: paperCode, title: paperTitle || paperCode } } : {}),
    topicIds,
    conceptIds,
  };
}

/** Whether the scope narrows the course at all. */
export function paperScopeIsWholeCourse(scope: Pick<PaperTopicScope, "course" | "topicIds" | "conceptIds">) {
  if (scope.topicIds.length === 0 && scope.conceptIds.length === 0) return true;
  const topics = servableExamSpecificationTopics(scope.course.specificationId)?.topics ?? [];
  return topics.length > 0 && topics.every((topic) => scope.topicIds.includes(topic.id));
}

/** The paper and course in words, as a student would name them. */
export function describePaperCourse(scope: Pick<PaperTopicScope, "course" | "paper">) {
  const { course } = scope;
  return [course.specificationTitle, course.tier ? `${course.tier} tier` : "", scope.paper?.title ?? ""]
    .filter(Boolean)
    .join(", ");
}

/**
 * What the paper covers and leaves out, from the checked catalogue's own
 * labels -- never the student's words -- or null for the whole course.
 */
export function describePaperTopicScope(scope: Pick<PaperTopicScope, "course" | "topicIds" | "conceptIds">) {
  if (paperScopeIsWholeCourse(scope)) return null;
  const specificationId = scope.course.specificationId;
  const topics = servableExamSpecificationTopics(specificationId)?.topics ?? [];
  const concepts = servableExamSpecificationConcepts(specificationId);
  const included: string[] = [];
  const left: string[] = [];
  for (const topic of topics) {
    if (scope.topicIds.includes(topic.id)) {
      included.push(topic.label);
      continue;
    }
    const chosen = concepts.filter((concept) => concept.parentTopicId === topic.id && scope.conceptIds.includes(concept.id));
    if (chosen.length > 0) included.push(`${topic.label} (only: ${chosen.map((concept) => concept.label).join("; ")})`);
    else left.push(topic.label);
  }
  return [
    `Cover only these parts of the course: ${included.join(", ")}.`,
    left.length ? `Leave out entirely, because the student is already confident with them: ${left.join(", ")}.` : "",
    "Where the chosen paper does not examine a chosen topic, keep to what the paper examines.",
  ]
    .filter(Boolean)
    .join(" ");
}
