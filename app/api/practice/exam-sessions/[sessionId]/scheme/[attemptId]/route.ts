import type { NextRequest } from "next/server";
import { apiFailure, authenticateRequest } from "@/services/auth/authenticate-request.server";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  EXAM_ID_PATTERN,
  examAnswerUnlocksModelAnswer,
  type ExamAttempt,
  type ExamSession,
} from "@/lib/practice/exam-questions";
import { schemePageRevealsUnanswered } from "@/lib/practice/exam-assets";
import { loadServableExamQuestion } from "@/services/practice/exam-evidence.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

export const runtime = "nodejs";

const SCHEME_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function notFound() {
  return apiFailure("Mark scheme not found.", 404, "scheme_not_found");
}

/**
 * The official mark scheme page for a question the student has had marked.
 *
 * Gated on exactly the terms the scheme's text is: the student's own attempt,
 * marked, and past the point that unlocks the model answer. The question's
 * rights are re-checked through the same loader the question's own images use,
 * at the version the session started on, so a withdrawn paper stops serving
 * its scheme at the same moment it stops serving its question.
 *
 * The page is the board's facsimile and can show neighbouring questions'
 * schemes. Showing it as soon as a question is marked was a deliberate product
 * decision: the published page is more useful to a student than any retelling
 * of it. `candidateExamAssets` still keeps it out of question material, so it
 * never appears beside a question that has not been answered -- and it waits
 * while this session still holds an unanswered question from the same paper,
 * whose scheme could be printed on it. The report falls back to this
 * question's own scheme text meanwhile.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; attemptId: string }> }
) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId, attemptId } = await params;
  if (![sessionId, attemptId].every((id) => EXAM_ID_PATTERN.test(id))) return notFound();

  const userRef = getAdminDb().collection("users").doc(uid);
  const attempt = (await userRef.collection("examAttempts").doc(attemptId).get()).data() as
    | ExamAttempt
    | undefined;
  if (
    !attempt ||
    attempt.sessionId !== sessionId ||
    attempt.answerDeletedAt ||
    attempt.status !== "marked" ||
    !attempt.result ||
    !examAnswerUnlocksModelAnswer(attempt.result)
  ) {
    return notFound();
  }

  const session = (await userRef.collection("examSessions").doc(sessionId).get()).data() as
    | ExamSession
    | undefined;
  const sessionQuestion = session?.questions.find((item) => item.id === attempt.questionId);
  if (!session || session.answersDeletedAt || !sessionQuestion) return notFound();

  const question = await loadServableExamQuestion(
    attempt.questionId,
    uid,
    sessionQuestion.contentVersion
  ).catch(() => null);
  const asset = [...(question?.reviewAssets ?? []), ...(question?.assets ?? [])].find(
    (item) => item.id === "scheme-extract"
  );
  const path = typeof asset?.storagePath === "string" ? asset.storagePath : "";
  const mimeType = typeof asset?.mimeType === "string" ? asset.mimeType : "";
  if (!path.startsWith("internal/examQuestionBank/") || !SCHEME_IMAGE_TYPES.includes(mimeType)) {
    return notFound();
  }
  if (!question?.paperId) return notFound();

  /*
   * Only official questions carry a printed scheme page, and only those not
   * yet unlocked can be given away by one. Bounded by the session itself.
   */
  const pending = session.questions.filter(
    (item) => item.id !== attempt.questionId && item.origin === "official_past_paper"
  );
  if (pending.length > 0) {
    const db = getAdminDb();
    const [attempts, questions] = await Promise.all([
      db.getAll(...pending.map((item) => userRef.collection("examAttempts").doc(item.attemptId))),
      db.getAll(...pending.map((item) => db.collection("examQuestions").doc(item.id))),
    ]);
    const siblings = pending.map((_, index) => {
      const sibling = attempts[index]?.data() as ExamAttempt | undefined;
      const paperId = questions[index]?.data()?.paperId;
      return {
        ...(typeof paperId === "string" ? { paperId } : {}),
        unlocked: Boolean(
          sibling &&
            !sibling.answerDeletedAt &&
            sibling.status === "marked" &&
            sibling.result &&
            examAnswerUnlocksModelAnswer(sibling.result)
        ),
      };
    });
    if (schemePageRevealsUnanswered({ paperId: question.paperId, siblings })) return notFound();
  }
  const [bytes] = await getAdminStorageBucket().file(path).download();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
