import "server-only";

import { getAdminDb } from "@/services/firebase/admin";
import { examDocument, type ExamIngestionVerification, type ExamQuestion, type ExamQuestionSecret } from "@/lib/practice/exam-questions";
import { getExamQuestionRights } from "@/lib/practice/exam-question-rights";
import {
  buildExamPaperManifest,
  type ExamCatalogueCourse,
  type ExamPaperCandidate,
  type ExamPaperManifestDraft,
} from "@/lib/practice/exam-ingestion-manifest";
import { discoverOfficialExamSources } from "@/services/practice/exam-source-discovery.server";
import { isExamQualification, type ExamBoardId } from "@/lib/practice/exam-formats";

const REVIEW_PAGE_SIZE = 25;

/**
 * A question waiting on a person, with everything needed to judge it.
 *
 * The mark scheme travels with it, which no student-facing projection ever
 * does: the whole job here is deciding whether the extraction paired the right
 * scheme to the right question, and that cannot be done without seeing both.
 */
export type ExamQuestionReviewItem = {
  id: string;
  paperId: string;
  label: string;
  prompt: string;
  marks: number;
  difficulty: ExamQuestion["difficulty"];
  status: ExamQuestion["status"];
  humanChecked: boolean;
  provenance: ExamQuestion["provenance"];
  verification?: ExamIngestionVerification;
  markScheme: {
    regime: string;
    officialText: string;
    modelAnswer?: string;
    criteria: Array<{ id: string; marks: number; text: string }>;
  };
};

function criteriaOf(secret: ExamQuestionSecret | undefined) {
  const item = secret?.markSchemeItem;
  if (!item) return [];
  if (item.marking === "additive" || item.marking === "pointPool") {
    return item.points.map((point) => ({ id: point.id, marks: point.marks, text: point.text }));
  }
  if (item.marking === "banded") {
    return item.bands.map((band, index) => ({
      id: `band-${index + 1}`,
      marks: band.maxMarks,
      text: band.descriptor,
    }));
  }
  return [];
}

/** Everything ingested that a person has not yet accepted or rejected. */
export async function listExamQuestionsAwaitingReview(paperId?: string) {
  const db = getAdminDb();
  let query: FirebaseFirestore.Query = db.collection("examQuestions")
    .where("origin", "==", "official_past_paper")
    .where("humanChecked", "==", false);
  if (paperId) query = query.where("paperId", "==", paperId);
  const snapshot = await query.limit(REVIEW_PAGE_SIZE).get();
  const questions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ExamQuestion & { verification?: ExamIngestionVerification }));
  const secrets = await Promise.all(
    questions.map((question) => db.collection("examQuestionSecrets").doc(question.id).get())
  );
  return questions.map((question, index): ExamQuestionReviewItem => {
    const secret = secrets[index]?.data() as ExamQuestionSecret | undefined;
    return {
      id: question.id,
      paperId: question.paperId,
      label: question.label,
      prompt: question.prompt,
      marks: question.marks,
      difficulty: question.difficulty,
      status: question.status,
      humanChecked: question.humanChecked,
      provenance: question.provenance,
      verification: question.verification,
      markScheme: {
        regime: secret?.markSchemeItem.marking ?? "missing",
        officialText: secret?.officialMarkScheme ?? "",
        modelAnswer: secret?.modelAnswer,
        criteria: criteriaOf(secret),
      },
    };
  });
}

/**
 * A person's decision on one extracted question.
 *
 * Accepting is the only path to `humanChecked`, and it is not something the
 * ingestion pipeline can reach: `ingestExamPaper` writes false and has no
 * branch that writes anything else. That is the point of the field -- a
 * licence makes material lawful to serve, and only a person looking at the
 * question decides whether the extraction of it is right.
 */
export async function decideExamQuestionReview(input: {
  questionId: string;
  decision: "accept" | "reject";
  reviewerUid: string;
}) {
  const db = getAdminDb();
  const ref = db.collection("examQuestions").doc(input.questionId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const question = snapshot.data() as ExamQuestion | undefined;
    if (!question) throw new Error("question_not_found");
    if (question.origin !== "official_past_paper") throw new Error("not_reviewable");
    transaction.update(ref, examDocument({
      humanChecked: input.decision === "accept",
      status: input.decision === "accept" ? "published" : "withdrawn",
      reviewedBy: input.reviewerUid,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
    }));
  });
}

/**
 * The papers a course has available, as manifests ingestion will accept.
 *
 * Discovery returns links; the catalogue knows the course. This joins them,
 * and drops any pair whose text does not say which sitting it is rather than
 * inventing one -- see `buildExamPaperManifest`.
 */
export async function findIngestibleExamPapers(input: {
  board: ExamBoardId;
  specificationId: string;
}): Promise<{ course: ExamCatalogueCourse | null; manifests: ExamPaperManifestDraft[]; discarded: number }> {
  const db = getAdminDb();
  const snapshot = await db.collection("examFormatCatalogue")
    .where("board", "==", input.board).limit(300).get();
  const entry = snapshot.docs
    .map((doc) => doc.data())
    .find((data) => data.status === "current" && data.specificationCode === input.specificationId);
  if (!entry) return { course: null, manifests: [], discarded: 0 };

  if (!isExamQualification(entry.qualification)) return { course: null, manifests: [], discarded: 0 };
  const course: ExamCatalogueCourse = {
    board: input.board,
    boardLabel: String(entry.boardLabel ?? input.board),
    qualification: entry.qualification,
    subject: String(entry.subject ?? ""),
    specificationCode: String(entry.specificationCode ?? ""),
    specificationTitle: String(entry.specificationTitle ?? entry.subject ?? ""),
    componentCode: String(entry.componentCode ?? ""),
    componentTitle: String(entry.componentTitle ?? ""),
  };

  // The board record is the licence; without one there is nothing to ingest
  // under, and inventing a key is the one thing the registry forbids.
  const rights = getExamQuestionRights(`${input.board}-2026`, 1);
  if (!rights) return { course, manifests: [], discarded: 0 };

  const candidates: ExamPaperCandidate[] = await discoverOfficialExamSources({
    board: input.board,
    specificationId: input.specificationId,
  });
  const manifests: ExamPaperManifestDraft[] = [];
  let discarded = 0;
  for (const candidate of candidates) {
    const manifest = buildExamPaperManifest({
      candidate,
      course,
      rightsKey: rights.key,
      rightsVersion: rights.version,
    });
    if (manifest) manifests.push(manifest);
    else discarded += 1;
  }
  return { course, manifests, discarded };
}
