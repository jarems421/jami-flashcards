import { getAiInputTokenCap } from "@/lib/ai/budgets";
import { getAiTokenCap } from "@/services/ai/budgets";
import { buildSingleQuestionAnswerParts, buildSingleQuestionPaper } from "@/lib/practice/single-question-paper";
import type { ExamAttempt, ExamSession } from "@/lib/practice/exam-questions";
import { markSingleQuestionAdaptively } from "@/services/ai/practice-paper-marking.server";
import { examQuestionVisualParts, loadExamQuestionSecret, loadServableExamQuestion } from "@/services/practice/exam-evidence.server";
import { loadQuestionTypeRules } from "@/services/practice/question-type-rules.server";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

// Reproduce the newest failed exam marking exactly as the job runs it, printing the error. Writes nothing.
export default async function main() {
  const all = await getAdminDb().collectionGroup("examAttempts").select("updatedAt", "status").get();
  const doc = all.docs.filter((d) => d.data().status === "marking_failed").sort((a, b) => (b.data().updatedAt ?? 0) - (a.data().updatedAt ?? 0))[0];
  const uid = doc.ref.parent.parent!.id;
  const attempt = (await doc.ref.get()).data() as ExamAttempt;
  const session = (await getAdminDb().collection("users").doc(uid).collection("examSessions").doc(attempt.sessionId).get()).data() as ExamSession;
  const question = session.questions.find((item) => item.id === attempt.questionId)!;
  console.log("question origin:", question.origin, "marks:", question.marks, "prompt chars:", String(question.prompt ?? "").length);
  const [bankQuestion, secret] = await Promise.all([
    loadServableExamQuestion(attempt.questionId, uid, question.contentVersion),
    loadExamQuestionSecret(attempt.questionId, uid, question.contentVersion),
  ]);
  const paper = buildSingleQuestionPaper({
    id: `exam-repro`, folderId: session.folderId, title: `${session.subject} ${question.label}`,
    question: { id: question.id, label: question.label, prompt: question.prompt, marks: question.marks, assets: question.assets },
    markSchemeItem: secret.markSchemeItem, studyLevel: session.studyLevel, qualification: session.course.qualification,
    awardingBody: question.provenance.boardLabel, specification: question.provenance.specificationTitle,
    component: question.provenance.componentTitle, markSchemeKind: question.origin === "jami_generated" ? "generated" : "official",
  });
  const originalPaperParts = await examQuestionVisualParts(bankQuestion);
  const bytes = attempt.workingSnapshotPath ? (await getAdminStorageBucket().file(attempt.workingSnapshotPath).download())[0] : undefined;
  console.log("original paper parts:", originalPaperParts.length, "snapshot bytes:", bytes?.length ?? 0);
  const answerParts = buildSingleQuestionAnswerParts({
    questionId: attempt.questionId, answerText: attempt.answerText,
    ...(bankQuestion.separateAwardMarks ? { separateAwardMarks: bankQuestion.separateAwardMarks } : {}),
    workingImage: bytes ? { inlineData: { mimeType: "image/png", data: bytes.toString("base64") } } : undefined,
  });
  const examinerPracticeRules = await loadQuestionTypeRules(paper.assessmentProfile, paper.title);
  try {
    const marked = await markSingleQuestionAdaptively({
      paper, answerParts, originalPaperParts, examinerPracticeRules,
      maxOutputTokens: getAiTokenCap("examQuestionMarking"),
      inputTokenCap: getAiInputTokenCap("examQuestionMarking"),
      deadlineAt: Date.now() + 600_000,
      forceVerification: true,
    });
    console.log("MARKED:", marked.result.questionResults[0]?.awardedMarks, "/", marked.result.questionResults[0]?.maxMarks);
    console.log("models:", JSON.stringify(marked.models));
  } catch (error) {
    console.log("FAILED:", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    const anyError = error as Record<string, unknown>;
    for (const key of Object.keys(anyError)) console.log(`  ${key}:`, JSON.stringify(anyError[key])?.slice(0, 1200));
    if (error instanceof Error && error.cause) console.log("  cause:", error.cause instanceof Error ? error.cause.message : JSON.stringify(error.cause).slice(0, 1200));
  }
}
