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
import { examSpecificationConceptCatalogue } from "@/lib/practice/exam-specification-concepts";
import { examSpecificationTopicCatalogue } from "@/lib/practice/exam-specification-topics";

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

  /*
   * Which ingested courses have checked topic and concept lists, and how much of
   * each has been tagged at each grain: the list to work down after ingesting.
   * A course with no list at all needs one drafted before tagging can start.
   */
  const bySpecification = new Map<string, ExamQuestion[]>();
  for (const question of official) {
    const key = `${question.provenance.board}/${question.provenance.specificationId}`;
    bySpecification.set(key, [...(bySpecification.get(key) ?? []), question]);
  }
  if (bySpecification.size > 0) {
    console.log("\nTagging by course (questions with topics / concepts / command word read):");
    for (const [key, list] of [...bySpecification].sort(([left], [right]) => left.localeCompare(right))) {
      const specificationId = list[0]!.provenance.specificationId;
      const topicList = examSpecificationTopicCatalogue(specificationId);
      const conceptList = examSpecificationConceptCatalogue(specificationId);
      const status = (known: boolean, checked: boolean) => (!known ? "none" : checked ? "checked" : "draft");
      console.log(
        `  ${key.padEnd(28)} ${String(list.length).padStart(5)} questions` +
          `  topic list ${status(Boolean(topicList), Boolean(topicList?.verified))}` +
          `, concept list ${status(Boolean(conceptList), conceptList?.provenance === "verified_specification")}` +
          `  tagged ${list.filter((question) => (question.topicIds?.length ?? 0) > 0).length}` +
          ` / ${list.filter((question) => Array.isArray(question.conceptIds)).length}` +
          ` / ${list.filter((question) => typeof question.commandWord === "string").length}`
      );
    }
  }
}
