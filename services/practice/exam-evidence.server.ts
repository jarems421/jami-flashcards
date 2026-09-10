import "server-only";
import { candidateExamAssets } from "@/lib/practice/exam-assets";
import type { AiContentPart } from "@/lib/ai/content-parts";
import type { ExamQuestion, ExamQuestionSecret } from "@/lib/practice/exam-questions";
import { isExamQuestionServable } from "@/lib/practice/exam-question-rights";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

/**
 * Where a question lives depends on who wrote it.
 *
 * Real past-paper questions are shared, owner-curated and licence-gated, so
 * they sit in the top-level bank. Jami-created gap fillers are neither
 * reviewed nor re-servable -- the course filter excludes them by origin -- so
 * they belong to the one student whose session asked for them and are written
 * under that student instead. Nothing unreviewed ever reaches the shared bank.
 */
function generatedQuestions(uid: string) {
  return getAdminDb().collection("users").doc(uid).collection("examGeneratedQuestions");
}

function generatedSecrets(uid: string) {
  return getAdminDb().collection("users").doc(uid).collection("examGeneratedSecrets");
}

export function examGeneratedQuestionRefs(uid: string) {
  return { questions: generatedQuestions(uid), secrets: generatedSecrets(uid) };
}

/**
 * The question a session actually started on, not whatever sits there now.
 *
 * A session snapshots the version it began with, and the scheme has honoured
 * that for a while -- but the question, and with it the images, did not. So
 * re-ingesting a paper changed the picture a running session displayed, the
 * picture sent to the marker, and the picture copied into a notebook, while
 * the scheme it was marked against stayed correctly pinned to the old one.
 * The two halves of the same question could come from different ingests.
 *
 * Rights stay live on purpose. An archived version is historical content, not
 * a historical licence: if the board's permission is withdrawn, or the
 * specification is switched off, or the paper is pulled, the old version stops
 * being servable at the same moment the current one does.
 */
export async function loadServableExamQuestion(
  questionId: string,
  uid: string,
  contentVersion?: string
) {
  const db = getAdminDb();
  const [shared, generated] = await Promise.all([
    db.collection("examQuestions").doc(questionId).get(),
    generatedQuestions(uid).doc(questionId).get(),
  ]);
  const snapshot = shared.exists ? shared : generated;
  if (!snapshot.exists) throw new Error("question_unavailable");
  const question = { ...snapshot.data(), id: snapshot.id } as ExamQuestion;
  if (!isExamQuestionServable(question)) throw new Error("question_unavailable");
  if (question.origin === "official_past_paper") {
    const paper = (await db.collection("examPapers").doc(question.paperId).get()).data();
    if (!paper || paper.status === "withdrawn" || paper.activeFrom > Date.now() ||
      (paper.activeUntil && paper.activeUntil < Date.now())) throw new Error("question_unavailable");
  }
  if (!contentVersion || !question.contentVersion || question.contentVersion === contentVersion) {
    return question;
  }
  const archived = await db
    .collection("examQuestionRevisions")
    .doc(`${questionId}_${contentVersion}`)
    .get();
  const revision = archived.data()?.question as ExamQuestion | undefined;
  // No archive means the version the session holds is simply gone. Serving
  // today's question in its place is the substitution this exists to prevent.
  if (!revision) throw new Error("question_changed");
  const restored = { ...revision, id: questionId } as ExamQuestion;
  if (!isExamQuestionServable(restored)) throw new Error("question_unavailable");
  return restored;
}

/**
 * The answer-bearing half, matching the question the student was actually
 * shown.
 *
 * A session snapshots a question's wording, but this used to load whatever
 * scheme currently sat under that id -- so re-ingesting a paper marked a
 * student against a scheme that no longer belonged to the question in front of
 * them, silently. When the current scheme is for different content, the
 * archived revision the session started with is used instead, and if that is
 * gone the answer is not marked at all rather than marked wrongly.
 */
export async function loadExamQuestionSecret(
  questionId: string,
  uid: string,
  contentVersion?: string
) {
  const db = getAdminDb();
  const [shared, generated] = await Promise.all([
    db.collection("examQuestionSecrets").doc(questionId).get(),
    generatedSecrets(uid).doc(questionId).get(),
  ]);
  const snapshot = shared.exists ? shared : generated;
  if (!snapshot.exists) throw new Error("question_secret_missing");
  const secret = snapshot.data() as ExamQuestionSecret;
  if (!contentVersion || !secret.contentVersion || secret.contentVersion === contentVersion) {
    return secret;
  }
  const archived = await db
    .collection("examQuestionRevisions")
    .doc(`${questionId}_${contentVersion}`)
    .get();
  const revision = archived.data()?.secret as ExamQuestionSecret | undefined;
  if (!revision) throw new Error("question_changed");
  return revision;
}

export async function examQuestionVisualParts(question: ExamQuestion): Promise<AiContentPart[]> {
  const parts: AiContentPart[] = [];
  let totalBytes = 0;
  for (const asset of candidateExamAssets(question)) {
    if (!asset.storagePath) continue;
    if (!asset.storagePath.startsWith("internal/examQuestionBank/") ||
      !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType ?? "")) throw new Error("question_asset_invalid");
    const [bytes] = await getAdminStorageBucket().file(asset.storagePath).download();
    totalBytes += bytes.length;
    if (totalBytes > 20 * 1024 * 1024) throw new Error("question_assets_too_large");
    parts.push({ text: `Original question asset: ${asset.title || asset.altText || asset.id}. This is question material, not student working.` });
    parts.push({ inlineData: { mimeType: asset.mimeType!, data: bytes.toString("base64") } });
  }
  return parts;
}
