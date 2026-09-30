import { getAdminDb } from "@/services/firebase/admin";
import {
  filterCanonicalConceptIds,
  servableExamSpecificationConcepts,
} from "@/lib/practice/exam-specification-concepts";
import { mapPracticePaperData } from "@/lib/practice/practice-papers";
import { mapStudyFolderData } from "@/lib/workspace/study-folders";
import { getTopicNameKey } from "@/lib/material/topics";

/**
 * Give legacy generated practice questions the concepts they were never told.
 *
 * Every paper generated before questions carried concept ids has questions
 * that test something the catalogue names, and no record of what. They are not
 * evidence about any concept until someone says what they are about.
 *
 * The matching here is deliberately, almost stubbornly, literal: a concept's
 * own label or one of its published aliases appearing in the question's text.
 * No model, no similarity, no "probably algebra". A question that does not
 * announce its concept is left alone, because a wrongly attributed mark is
 * worse for a learner model than a missing one -- it moves a number instead of
 * leaving it honest. A low match rate is a real answer, not a failure.
 *
 * Five properties, because this writes to a student's own papers:
 *
 * - dry run by default; `--apply` is the only thing that writes
 * - bounded by `--limit`, defaulting small
 * - resumable through `--after <paperId>`, papers being processed in id order
 * - auditable: every proposal is printed with the text that matched it
 * - idempotent: a question that already has concept ids is never touched, so
 *   the same run twice changes nothing the second time
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/practice-concept-backfill.ts --uid <uid> [--folder <id>]
 *     [--limit 20] [--after <paperId>] [--apply]
 */

type Proposal = {
  paperId: string;
  questionId: string;
  conceptIds: string[];
  matchedOn: string;
};

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

/**
 * Concept labels and aliases, longest first.
 *
 * Longest first so "completing the square" wins over "the square" when a
 * catalogue happens to contain both; a shorter accidental substring should
 * never claim a question a longer exact phrase describes.
 */
function matchers(specificationId: string) {
  const concepts = servableExamSpecificationConcepts(specificationId);
  const entries: { phrase: string; conceptId: string }[] = [];
  for (const concept of concepts) {
    for (const phrase of [concept.label, ...(concept.aliases ?? [])]) {
      const normalized = getTopicNameKey(phrase);
      // Two words minimum: single common words match far too much.
      if (normalized.split(" ").length >= 2) {
        entries.push({ phrase: normalized, conceptId: concept.id });
      }
    }
  }
  return entries.sort((left, right) => right.phrase.length - left.phrase.length);
}

export default async function main() {
  const uid = arg("uid");
  const folderId = arg("folder");
  const after = arg("after");
  const apply = process.argv.includes("--apply");
  const limit = Math.max(1, Math.min(200, Number.parseInt(arg("limit") ?? "20", 10) || 20));
  if (!uid) {
    console.error(
      "Usage: --uid <uid> [--folder <id>] [--limit 20] [--after <paperId>] [--apply]"
    );
    process.exit(1);
  }

  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);

  const folders = new Map<string, string>();
  const folderSnap = await userRef.collection("studyFolders").limit(50).get();
  for (const folderDoc of folderSnap.docs) {
    const folder = mapStudyFolderData(folderDoc.id, folderDoc.data() as Record<string, unknown>);
    if (folder.examCourse) folders.set(folderDoc.id, folder.examCourse.specificationId);
  }

  let query = userRef.collection("pastPapers").orderBy("__name__").limit(limit);
  if (after) query = userRef.collection("pastPapers").orderBy("__name__").startAfter(after).limit(limit);
  const papers = await query.get();

  console.log(`\n${apply ? "APPLYING" : "DRY RUN"} — ${papers.size} paper(s) read`);
  if (!apply) console.log("Nothing will be written. Re-run with --apply to write.\n");

  const proposals: Proposal[] = [];
  let skippedNoCourse = 0;
  let alreadyTagged = 0;
  let unmatched = 0;
  let lastPaperId = "";

  for (const paperDoc of papers.docs) {
    lastPaperId = paperDoc.id;
    const data = paperDoc.data() as Record<string, unknown>;
    const paperFolderId = typeof data.folderId === "string" ? data.folderId : "";
    if (folderId && paperFolderId !== folderId) continue;

    const specificationId = folders.get(paperFolderId);
    if (!specificationId) {
      skippedNoCourse += 1;
      continue;
    }

    const paper = mapPracticePaperData(paperDoc.id, data, specificationId);
    const phrases = matchers(specificationId);
    const updates: Record<string, string[]> = {};

    for (const question of paper.questions) {
      // Idempotent: never touch a question that already says what it tests.
      if (question.conceptIds?.length) {
        alreadyTagged += 1;
        continue;
      }
      const haystack = getTopicNameKey(`${question.label} ${question.prompt}`);
      const hit = phrases.find((entry) => haystack.includes(entry.phrase));
      if (!hit) {
        unmatched += 1;
        continue;
      }
      const { conceptIds } = filterCanonicalConceptIds(specificationId, [hit.conceptId]);
      if (conceptIds.length === 0) {
        unmatched += 1;
        continue;
      }
      updates[question.id] = conceptIds;
      proposals.push({
        paperId: paperDoc.id,
        questionId: question.id,
        conceptIds,
        matchedOn: hit.phrase,
      });
    }

    if (apply && Object.keys(updates).length > 0) {
      const questions = (Array.isArray(data.questions) ? data.questions : []).map((candidate) => {
        if (!candidate || typeof candidate !== "object") return candidate;
        const item = candidate as Record<string, unknown>;
        const id = typeof item.id === "string" ? item.id : "";
        return updates[id] ? { ...item, conceptIds: updates[id] } : item;
      });
      await paperDoc.ref.update({ questions });
    }
  }

  for (const proposal of proposals) {
    console.log(
      `  ${proposal.paperId}/${proposal.questionId}  →  ${proposal.conceptIds.join(", ")}` +
        `   (matched "${proposal.matchedOn}")`
    );
  }

  console.log(
    `\nProposed ${proposals.length}  ·  already tagged ${alreadyTagged}  ·  ` +
      `no match ${unmatched}  ·  papers without a course ${skippedNoCourse}`
  );
  if (papers.size === limit) {
    console.log(`More papers remain. Resume with --after ${lastPaperId}`);
  }
  console.log(
    apply
      ? "Written.\n"
      : "Nothing written. Review the matches above, then re-run with --apply.\n"
  );
}
