import "server-only";

import { isExamBoardId, type ExamFormatProfileVersion } from "@/lib/practice/exam-formats";
import { isExamQuestionServable } from "@/lib/practice/exam-question-rights";
import type { ExamQuestion } from "@/lib/practice/exam-questions";
import { groupExamQuestions } from "@/lib/practice/exam-question-groups";
import {
  exemplarBlock,
  examExemplarFromGroup,
  MODELLED_QUESTION_INSTRUCTION,
  type ExamExemplar,
} from "@/lib/practice/exam-exemplars";
import { conceptParentTopicIds } from "@/lib/practice/exam-specification-concepts";
import { paperScopeIsWholeCourse, type PaperTopicScope } from "@/lib/practice/paper-topic-scope";
import {
  buildPaperCorpusCalibration,
  MIN_CALIBRATION_QUESTIONS,
} from "@/lib/practice/paper-corpus-calibration";
import { getAdminDb } from "@/services/firebase/admin";

type CalibrationCourse = {
  board: string;
  specificationId: string;
  specificationTitle: string;
  componentIds: string[];
};

/** The folder's course is the student's own statement of what they sit, so it is asked first. */
function courseFromFolder(data: Record<string, unknown> | undefined): CalibrationCourse | null {
  const course = data?.examCourse;
  if (!course || typeof course !== "object") return null;
  const value = course as Record<string, unknown>;
  const board = typeof value.board === "string" ? value.board : "";
  const specificationId = typeof value.specificationId === "string" ? value.specificationId.trim() : "";
  if (!isExamBoardId(board) || !specificationId) return null;
  return {
    board,
    specificationId,
    specificationTitle:
      typeof value.specificationTitle === "string" && value.specificationTitle.trim()
        ? value.specificationTitle.trim()
        : specificationId,
    componentIds: Array.isArray(value.componentIds)
      ? value.componentIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
      : [],
  };
}

function courseFromProfile(profile: ExamFormatProfileVersion | undefined): CalibrationCourse | null {
  if (!profile?.specificationCode) return null;
  return {
    board: profile.board,
    specificationId: profile.specificationCode,
    specificationTitle: profile.specificationTitle || profile.specificationCode,
    componentIds: profile.componentCode ? [profile.componentCode] : [],
  };
}

/** `1MA1/1H` and `1H` name the same component, whichever way round they are written. */
const sameComponent = (code: string, wanted: string) =>
  code === wanted || code.endsWith(`/${wanted}`) || wanted.endsWith(`/${code}`);

/**
 * Calibration for one practice paper, or null when the corpus has nothing reliable for its course.
 *
 * Only questions a student could be served count -- reviewed, spot-checked,
 * rights intact -- so a withdrawn or unchecked extraction never shapes a paper.
 */
export async function loadPaperCorpusCalibration(input: {
  uid: string;
  folderId: string;
  profile?: ExamFormatProfileVersion;
  /** The course, paper and topics the student picked, which outrank the folder's course. */
  scope?: PaperTopicScope;
}) {
  const db = getAdminDb();
  const course = input.scope
    ? {
        board: input.scope.course.board,
        specificationId: input.scope.course.specificationId,
        specificationTitle: input.scope.course.specificationTitle,
        componentIds: input.scope.paper?.code ? [input.scope.paper.code] : input.scope.course.componentIds,
      }
    : courseFromFolder(
        (await db.collection("users").doc(input.uid).collection("studyFolders").doc(input.folderId).get()).data()
      ) ?? courseFromProfile(input.profile);
  if (!course) return null;

  const snapshot = await db
    .collection("examQuestions")
    .where("provenance.board", "==", course.board)
    .where("provenance.specificationId", "==", course.specificationId)
    .where("status", "==", "published")
    .limit(800)
    .get();
  const servable = snapshot.docs
    .map((doc) => ({ ...(doc.data() as ExamQuestion), id: doc.id }))
    .filter((question) => isExamQuestionServable(question));

  // The student's own papers when the corpus holds enough of them; otherwise
  // the whole specification still shows how the board writes.
  const narrowed = course.componentIds.length
    ? servable.filter((question) =>
        course.componentIds.some((wanted) => sameComponent(question.provenance.componentCode, wanted))
      )
    : [];
  const pool = narrowed.length >= MIN_CALIBRATION_QUESTIONS ? narrowed : servable;

  const calibration = buildPaperCorpusCalibration({
    board: course.board,
    specificationId: course.specificationId,
    specificationTitle: course.specificationTitle,
    questions: pool.map((question) => ({
      paperId: question.paperId,
      componentCode: question.provenance.componentCode,
      questionNumber: question.provenance.questionNumber,
      prompt: question.prompt,
      marks: question.marks,
      topicIds: question.topicIds ?? [],
      difficulty: question.difficulty,
    })),
  });
  if (!calibration) return null;
  const exemplars = paperExemplars(pool, input.scope);
  if (exemplars.length === 0) return calibration;
  return {
    ...calibration,
    context: [
      calibration.context,
      "MODEL QUESTIONS. Build most of the paper's questions on these real questions from this course, choosing the ones that fit each part of the paper and the topics asked for, so the paper reads like the board's own. " +
        MODELLED_QUESTION_INSTRUCTION,
      exemplarBlock(exemplars, "MODEL QUESTION"),
    ].join("\n\n"),
  };
}

/** How many real questions a paper is shown to model on: enough for a paper's variety, not a paper's worth of text. */
const MAX_PAPER_EXEMPLARS = 16;

/**
 * Real questions to model a paper on: whole questions, in the chosen topics
 * when the student narrowed them, spread across difficulty and taken at random
 * so two papers on one course are not built on the same few.
 */
function paperExemplars(pool: ExamQuestion[], scope: PaperTopicScope | undefined): ExamExemplar[] {
  const narrowed = scope && !paperScopeIsWholeCourse(scope) ? scope : null;
  // A whole topic chosen, or the topic above a chosen concept: its questions show the style either way.
  const topics = narrowed
    ? new Set([...narrowed.topicIds, ...conceptParentTopicIds(narrowed.course.specificationId, narrowed.conceptIds)])
    : null;
  const groups = groupExamQuestions(pool).filter(
    (group) => !topics || group.parts.some((part) => (part.topicIds ?? []).some((id) => topics.has(id)))
  );
  const shuffled = groups
    .map((group) => ({ group, key: Math.random() }))
    .sort((left, right) => left.key - right.key)
    .map((entry) => entry.group);
  const chosen: ExamExemplar[] = [];
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    for (const group of shuffled.filter((item) => item.difficulty === difficulty)) {
      if (chosen.filter((item) => item.difficulty === difficulty).length >= Math.ceil(MAX_PAPER_EXEMPLARS / 3)) break;
      const exemplar = examExemplarFromGroup(group);
      if (exemplar) chosen.push(exemplar);
    }
  }
  return chosen.slice(0, MAX_PAPER_EXEMPLARS);
}
