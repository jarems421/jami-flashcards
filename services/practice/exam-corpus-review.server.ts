import "server-only";

import { getAdminDb } from "@/services/firebase/admin";
import {
  examDocument,
  examQuestionPublicationBlockers,
  type ExamIngestionVerification,
  type ExamQuestion,
  type ExamQuestionSecret,
} from "@/lib/practice/exam-questions";
import { getExamQuestionRights } from "@/lib/practice/exam-question-rights";
import {
  buildExamPaperManifest,
  type ExamCatalogueCourse,
  type ExamPaperCandidate,
  type ExamPaperManifestDraft,
} from "@/lib/practice/exam-ingestion-manifest";
import { discoverOfficialExamSources } from "@/services/practice/exam-source-discovery.server";
import { reviewExamQuestionWithAi } from "@/services/practice/exam-ai-review.server";
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
  review: ExamQuestion["review"];
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

async function listExamQuestionsAwaitingReviewRaw(paperId?: string, limit = REVIEW_PAGE_SIZE) {
  const db = getAdminDb();
  let query: FirebaseFirestore.Query = db.collection("examQuestions")
    .where("origin", "==", "official_past_paper")
    .where("review.status", "in", ["pending", "review_failed"]);
  if (paperId) query = query.where("paperId", "==", paperId);
  const snapshot = await query.limit(limit).get();
  const questions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ExamQuestion & { verification?: ExamIngestionVerification }));
  const secrets = await Promise.all(
    questions.map((question) => db.collection("examQuestionSecrets").doc(question.id).get())
  );
  return questions.map((question, index) => ({
    question,
    secret: secrets[index]?.data() as ExamQuestionSecret | undefined,
  }));
}

/** Everything ingested that nobody has accepted or rejected yet. */
export async function listExamQuestionsAwaitingReview(paperId?: string) {
  const rows = await listExamQuestionsAwaitingReviewRaw(paperId);
  return rows.map(({ question, secret }): ExamQuestionReviewItem => {
    return {
      id: question.id,
      paperId: question.paperId,
      label: question.label,
      prompt: question.prompt,
      marks: question.marks,
      difficulty: question.difficulty,
      status: question.status,
      review: question.review ?? { status: "pending", notes: [] },
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
 * A person's word overrides the reviewer model in either direction, and is
 * recorded as such. Ingestion itself can never approve anything: it writes
 * `pending` and has no branch that writes anything else, so every extracted
 * question is checked by someone before a student can reach it.
 */
/**
 * Run the reviewer over everything still pending, a few at a time.
 *
 * Bounded per call rather than looped to exhaustion: each question costs a
 * vision request, and a run that quietly walks a whole corpus is a bill nobody
 * chose. The caller repeats until `remaining` is zero and can stop whenever.
 */
export async function reviewPendingExamQuestionsWithAi(input: {
  limit: number;
  paperId?: string;
}) {
  const db = getAdminDb();
  const pending = await listExamQuestionsAwaitingReviewRaw(input.paperId, Math.max(1, Math.min(25, input.limit)));
  const outcomes = [];
  for (const { question, secret } of pending) {
    // The same gate ingestion used. Sending a structurally broken question to
    // a reviewer only buys an opinion about something already disqualified.
    const blockers = examQuestionPublicationBlockers(
      (question as ExamQuestion & { verification?: ExamIngestionVerification }).verification
    );
    const outcome = blockers.length > 0
      ? { questionId: question.id, review: { status: "rejected" as const, by: "ai" as const, at: Date.now(), notes: blockers } }
      : await reviewExamQuestionWithAi({ question, secret });
    const ref = db.collection("examQuestions").doc(question.id);
    await db.runTransaction(async (transaction) => {
      const current = (await transaction.get(ref)).data() as ExamQuestion | undefined;
      // A person who decided while the model was still thinking has the last
      // word; a late verdict must not overwrite them.
      if (!current || current.review?.by === "human") return;
      transaction.update(ref, examDocument({
        review: outcome.review,
        status: outcome.review.status === "approved" ? "published" : "needs_review",
        updatedAt: Date.now(),
      }));
    });
    outcomes.push(outcome);
  }
  const remaining = (await db.collection("examQuestions")
    .where("origin", "==", "official_past_paper")
    .where("review.status", "in", ["pending", "review_failed"])
    .count().get()).data().count;
  return {
    reviewed: outcomes.length,
    approved: outcomes.filter((item) => item.review.status === "approved").length,
    rejected: outcomes.filter((item) => item.review.status === "rejected").length,
    failed: outcomes.filter((item) => item.review.status === "review_failed").length,
    remaining,
  };
}

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
    /*
     * A reviewer judges the wording; they do not get to wave through a
     * mispaired scheme or a question whose region was never located. Those
     * survive any opinion, so accepting one is refused rather than recorded.
     */
    const blockers = examQuestionPublicationBlockers(
      (question as ExamQuestion & { verification?: ExamIngestionVerification }).verification
    );
    if (input.decision === "accept" && blockers.length > 0) throw new Error("publication_blocked");
    const now = Date.now();
    transaction.update(ref, examDocument({
      review: {
        status: input.decision === "accept" ? "approved" : "rejected",
        by: "human" as const,
        reviewerUid: input.reviewerUid,
        at: now,
        notes: [],
      },
      // A person overruling the reviewer is the last word, in both directions:
      // withdrawn rather than needs_review, so it does not come back round.
      status: input.decision === "accept" ? "published" : "withdrawn",
      updatedAt: now,
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
