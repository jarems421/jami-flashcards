import "server-only";

import { isExamBoardId, type ExamFormatProfileVersion } from "@/lib/practice/exam-formats";
import { isExamQuestionServable } from "@/lib/practice/exam-question-rights";
import type { ExamQuestion } from "@/lib/practice/exam-questions";
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
}) {
  const db = getAdminDb();
  const folder = await db.collection("users").doc(input.uid).collection("studyFolders").doc(input.folderId).get();
  const course = courseFromFolder(folder.data()) ?? courseFromProfile(input.profile);
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

  return buildPaperCorpusCalibration({
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
}
