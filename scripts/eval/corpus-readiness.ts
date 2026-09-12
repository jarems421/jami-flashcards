/**
 * What the student-facing corpus would actually serve today.
 *
 * Every gate in `isExamQuestionServable` is a different reason a stored
 * question stays invisible, and "the page is empty" says nothing about which
 * one. This counts the corpus against each gate in turn, so an empty surface
 * can be read as a missing spot-check rather than a broken feature.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/corpus-readiness.ts
 */
import { getAdminDb } from "@/services/firebase/admin";
import { isExamQuestionApproved, type ExamQuestion } from "@/lib/practice/exam-questions";
import {
  getExamQuestionRights,
  isExamQuestionBoardEnabled,
  isExamQuestionServable,
} from "@/lib/practice/exam-question-rights";

export default async function main() {
  const db = getAdminDb();
  const snapshot = await db.collection("examQuestions").get();
  // Read as stored: the collection is the source of truth the gates run over.
  const questions = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as ExamQuestion);

  const official = questions.filter((question) => question.origin === "official_past_paper");
  const jami = questions.filter((question) => question.origin !== "official_past_paper");

  const counts = {
    total: questions.length,
    official: official.length,
    jamiOriginal: jami.length,
    published: questions.filter((question) => question.status === "published").length,
    reviewApproved: official.filter((question) => isExamQuestionApproved(question.review)).length,
    paperSpotChecked: official.filter((question) => typeof question.paperSpotCheckedAt === "number").length,
    rightsRecordFound: questions.filter((question) =>
      Boolean(getExamQuestionRights(question.rights.key, question.rights.version))
    ).length,
    boardSwitchedOn: official.filter((question) => isExamQuestionBoardEnabled(question.provenance.board)).length,
    servable: questions.filter((question) => isExamQuestionServable(question)).length,
  };

  console.log("Exam question corpus readiness\n");
  for (const [name, value] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(20)} ${value}`);
  }

  if (counts.total === 0) {
    console.log("\nNothing ingested. Every switch being on changes nothing until a corpus exists.");
  } else if (counts.servable === 0) {
    console.log("\nNothing servable. The first count above that falls short is the reason.");
  } else {
    const bySubject = new Map<string, number>();
    for (const question of questions.filter((item) => isExamQuestionServable(item))) {
      const key = `${question.provenance.board}/${question.provenance.specificationId}`;
      bySubject.set(key, (bySubject.get(key) ?? 0) + 1);
    }
    console.log("\nServable now:");
    for (const [key, value] of [...bySubject].sort()) console.log(`  ${key.padEnd(40)} ${value}`);
  }
}
