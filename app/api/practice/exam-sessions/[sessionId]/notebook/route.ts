import type { NextRequest } from "next/server";
import { apiFailure, authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import { buildNotebookPagePayload, type NotebookImageRef } from "@/lib/workspace/notebooks";
import { EXAM_ID_PATTERN, type ExamAttempt, type ExamQuestion, type ExamSession } from "@/lib/practice/exam-questions";
import { normalizeQuestionAssets, type PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { featureFlags } from "@/lib/app/feature-flags";
import { loadServableExamQuestion } from "@/services/practice/exam-evidence.server";
import { candidateExamAssets } from "@/lib/practice/exam-assets";

export const runtime = "nodejs";

/** The pad's own page shape, used only when an older attempt recorded none. */
const WORKING_FALLBACK_WIDTH = 1_200;
const WORKING_FALLBACK_HEIGHT = 1_653;
const WORKING_MAX_DISPLAY_WIDTH = 620;

function compactFeedback(attempt: ExamAttempt) {
  const result = attempt.result;
  if (!result) return "";
  const earned = (result.criterionResults ?? []).filter((item) => (item.awardedMarks ?? 0) > 0).map((item) => `• ${item.criterion}`);
  const improve = (result.criterionResults ?? []).filter((item) => (item.awardedMarks ?? 0) === 0).map((item) => `• ${item.criterion}`);
  return [
    `MARKED WORK · ${result.awardedMarks}/${result.maxMarks}`,
    "", "Your answer", attempt.answerText || "Working only", "",
    earned.length ? `What earned marks\n${earned.join("\n")}` : "",
    improve.length ? `What to improve\n${improve.join("\n")}` : "",
    result.nextStep ? `Next step\n${result.nextStep}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 30_000);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  if (!featureFlags.enablePastPaperPractice) return apiFailure("Not found", 404, "not_found");
  const uid = await authenticateWriteRequest(request);
  if (!uid) return apiFailure("Unauthorized", 401, "unauthorized");
  const { sessionId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
  const notebookId = typeof body.notebookId === "string" ? body.notebookId : "";
  if (![sessionId, attemptId, notebookId].every((id) => EXAM_ID_PATTERN.test(id))) return apiFailure("Choose a notebook.", 400, "invalid_request");
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const [sessionSnapshot, attemptSnapshot, notebookSnapshot] = await Promise.all([
    userRef.collection("examSessions").doc(sessionId).get(),
    userRef.collection("examAttempts").doc(attemptId).get(),
    userRef.collection("notebooks").doc(notebookId).get(),
  ]);
  const session = sessionSnapshot.data() as ExamSession | undefined;
  const attempt = attemptSnapshot.data() as ExamAttempt | undefined;
  const notebook = notebookSnapshot.data();
  if (!session || !attempt || !notebook || attempt.sessionId !== sessionId || notebook.folderId !== session.folderId) return apiFailure("That notebook is not available for this session.", 404, "notebook_not_found");
  if (attempt.status !== "marked" || !attempt.result) return apiFailure("Mark this answer before saving it.", 409, "attempt_not_marked");
  const question = session.questions.find((item) => item.id === attempt.questionId);
  if (!question) return apiFailure("Question not found.", 404, "question_not_found");

  const exportId = `${attemptId}_${notebookId}`;
  const exportRef = userRef.collection("examNotebookExports").doc(exportId);
  const prior = await exportRef.get();
  if (prior.exists) return Response.json({ pageId: prior.data()?.pageId, notebookId, alreadySaved: true });

  /*
   * The same loader marking uses, which is the only one that finds a
   * Jami-created filler: those live in the student's own collection, so an
   * export that read the shared bank could not copy the question a gap-filled
   * session had actually asked -- it returned "no longer available" for a
   * question sitting on the screen beside the button.
   */
  let bankQuestion: ExamQuestion;
  try {
    bankQuestion = await loadServableExamQuestion(question.id, uid, question.contentVersion);
  } catch {
    return apiFailure("This question is no longer available to copy.", 410, "question_unavailable");
  }
  const bucket = getAdminStorageBucket();
  const copiedAssets: PracticePaperQuestionAsset[] = [];
  for (const asset of normalizeQuestionAssets(candidateExamAssets(bankQuestion))) {
    if (!asset.storagePath) { copiedAssets.push(asset); continue; }
    const destination = `users/${uid}/practiceNotebookCopies/${exportId}/asset-${asset.id}`;
    await bucket.file(asset.storagePath).copy(bucket.file(destination));
    copiedAssets.push({ ...asset, storagePath: destination });
  }
  const imageRefs: NotebookImageRef[] = [];
  if (attempt.workingSnapshotPath) {
    const destination = `users/${uid}/practiceNotebookCopies/${exportId}/working.png`;
    await bucket.file(attempt.workingSnapshotPath).copy(bucket.file(destination));
    // The pad is a portrait sheet, so the placed copy has to keep its own
    // shape rather than a guessed one: the frozen size is recorded on the
    // attempt precisely so the notebook can lay it out without measuring.
    const width = Math.max(1, Math.round(attempt.workingWidth ?? WORKING_FALLBACK_WIDTH));
    const height = Math.max(1, Math.round(attempt.workingHeight ?? WORKING_FALLBACK_HEIGHT));
    const displayWidth = Math.min(WORKING_MAX_DISPLAY_WIDTH, width);
    imageRefs.push({
      id: `working-${attempt.id}`, storagePath: destination,
      width, height, x: 80, y: 600,
      displayWidth, displayHeight: Math.round((displayWidth * height) / width),
      altText: "Frozen working from Past Paper Practice",
    });
  }
  const pageRef = userRef.collection("notebookPages").doc(`exam_${exportId}`.slice(0, 1_400));
  await db.runTransaction(async (transaction) => {
    const [existingExport, lastPage] = await Promise.all([
      transaction.get(exportRef),
      transaction.get(userRef.collection("notebookPages").where("notebookId", "==", notebookId).orderBy("pageNumber", "desc").limit(1)),
    ]);
    if (existingExport.exists) return;
    const pageNumber = (lastPage.docs[0]?.data().pageNumber ?? 0) + 1;
    transaction.set(pageRef, buildNotebookPagePayload({
      notebookId, folderId: session.folderId, pageNumber,
      title: `${question.label} · ${attempt.result!.awardedMarks}/${attempt.result!.maxMarks}`,
      pageType: "question", pageColor: "white", pageStyle: "plain", status: "marked",
      questionPrompt: `${question.prompt}\n\n[${question.marks} ${question.marks === 1 ? "mark" : "marks"}]`,
      questionAssets: copiedAssets, typedContent: compactFeedback(attempt), imageRefs,
      linkedQuestionId: question.id, linkedExamAttemptId: attempt.id, linkedExamSessionId: session.id,
    }));
    transaction.set(exportRef, { pageId: pageRef.id, notebookId, attemptId, sessionId, createdAt: Date.now() });
    transaction.update(notebookSnapshot.ref, { updatedAt: Date.now() });
  });
  return Response.json({ pageId: pageRef.id, notebookId, alreadySaved: false });
}
