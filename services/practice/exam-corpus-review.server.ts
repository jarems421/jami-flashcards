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
import { findExamPapersByPattern } from "@/services/practice/exam-source-discovery.server";
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
 * A random handful of what the reviewer approved, for a person to read.
 *
 * Random rather than the first N, because extraction faults cluster: the early
 * questions of a paper are the ones whose regions are easiest to locate, so a
 * sample taken from the top is a sample of the cases most likely to be right.
 *
 * The whole sample is read in memory. A paper is tens of questions, not
 * thousands, and the alternative -- a random cursor over `selectionKey` -- buys
 * nothing at this size except a way to be subtly non-uniform.
 */
export async function sampleApprovedExamQuestions(input: { paperId: string; size: number }) {
  const db = getAdminDb();
  const snapshot = await db.collection("examQuestions")
    .where("origin", "==", "official_past_paper")
    .where("paperId", "==", input.paperId)
    .where("review.status", "==", "approved")
    .limit(500)
    .get();
  const questions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ExamQuestion & { verification?: ExamIngestionVerification }));
  const shuffled = [...questions];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[pick]] = [shuffled[pick]!, shuffled[index]!];
  }
  const size = Math.max(1, Math.min(25, input.size));
  const drawn = shuffled.slice(0, size);
  const secrets = await Promise.all(
    drawn.map((question) => db.collection("examQuestionSecrets").doc(question.id).get())
  );
  return {
    population: questions.length,
    questions: drawn.map((question, index) => {
      const secret = secrets[index]?.data() as ExamQuestionSecret | undefined;
      return {
        id: question.id,
        paperId: question.paperId,
        label: question.label,
        prompt: question.prompt,
        marks: question.marks,
        difficulty: question.difficulty,
        status: question.status,
        review: question.review,
        provenance: question.provenance,
        verification: question.verification,
        markScheme: {
          regime: secret?.markSchemeItem.marking ?? "missing",
          officialText: secret?.officialMarkScheme ?? "",
          modelAnswer: secret?.modelAnswer,
          criteria: criteriaOf(secret),
        },
      } satisfies ExamQuestionReviewItem;
    }),
  };
}

/**
 * Pull a batch of questions as a class.
 *
 * A spot-check that finds a fault has almost never found *one* fault: the
 * scheme paired one question out, the region located on the wrong page and the
 * tariff read off the next line all run through an extraction, so the useful
 * response is withdrawing the batch rather than hunting the rest one at a time.
 *
 * Withdrawn, not sent back for review -- the reviewer already approved these,
 * so returning them to the queue would hand them to the thing that missed it.
 */
export async function revokeExamQuestionBatch(input: {
  questionIds: readonly string[];
  reviewerUid: string;
  reason: string;
}) {
  const db = getAdminDb();
  const ids = [...new Set(input.questionIds)].slice(0, 400);
  const reason = input.reason.trim().slice(0, 500);
  if (ids.length === 0 || reason.length < 3) throw new Error("invalid_revocation");
  const now = Date.now();
  const batch = db.batch();
  for (const id of ids) {
    batch.update(db.collection("examQuestions").doc(id), examDocument({
      status: "withdrawn",
      review: {
        status: "rejected" as const,
        by: "human" as const,
        reviewerUid: input.reviewerUid,
        at: now,
        notes: [reason],
      },
      updatedAt: now,
    }));
  }
  await batch.commit();
  return { withdrawn: ids.length };
}

/**
 * Record that a person sampled a paper, and let its questions be served.
 *
 * The stamp goes on every question of the paper rather than on the paper alone,
 * because the gate that reads it -- `isExamQuestionServable` -- takes a question
 * and has no database. It says the paper's extraction was sampled and accepted,
 * which is a claim about the extraction rather than about each question.
 *
 * A sample that rejected everything it drew does not count as a pass: the paper
 * is recorded and nothing is stamped, so it stays unservable until somebody
 * looks again at whatever is left.
 */
export async function recordExamPaperSpotCheck(input: {
  paperId: string;
  reviewerUid: string;
  size: number;
  rejected: number;
  notes?: string;
}) {
  const db = getAdminDb();
  const paperRef = db.collection("examPapers").doc(input.paperId);
  if (!(await paperRef.get()).exists) throw new Error("paper_not_found");
  const approved = await db.collection("examQuestions")
    .where("origin", "==", "official_past_paper")
    .where("paperId", "==", input.paperId)
    .where("review.status", "==", "approved")
    .limit(500)
    .get();
  const now = Date.now();
  const spotCheck = {
    sampledAt: now,
    sampledBy: input.reviewerUid,
    size: Math.max(0, Math.round(input.size)),
    rejected: Math.max(0, Math.round(input.rejected)),
    population: approved.size,
    ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 500) } : {}),
  };
  await paperRef.update(examDocument({ spotCheck, updatedAt: now }));
  /*
   * Nothing is stamped when the sample found nothing worth keeping. Recording
   * the attempt and serving none of it is the honest outcome: the paper has
   * been looked at, and it did not pass.
   */
  if (spotCheck.size === 0 || spotCheck.rejected >= spotCheck.size) {
    return { ...spotCheck, stamped: 0, passed: false };
  }
  let stamped = 0;
  let batch = db.batch();
  let operations = 0;
  const commits: Promise<unknown>[] = [];
  for (const document of approved.docs) {
    batch.update(document.ref, examDocument({ paperSpotCheckedAt: now, updatedAt: now }));
    stamped += 1;
    operations += 1;
    if (operations >= 400) {
      commits.push(batch.commit());
      batch = db.batch();
      operations = 0;
    }
  }
  commits.push(batch.commit());
  await Promise.all(commits);
  return { ...spotCheck, stamped, passed: true };
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

  // Recent series only, so the owner sees something quickly; a full rollout
  // goes through the batch queue rather than this preview.
  const thisYear = new Date().getUTCFullYear();
  const candidates: ExamPaperCandidate[] = await findExamPapersByPattern({
    board: input.board,
    specificationId: input.specificationId,
    componentCode: course.componentCode,
    years: [thisYear - 1, thisYear - 2],
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
