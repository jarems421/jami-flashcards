import "server-only";

import { findQuestionStarts } from "@/lib/practice/exam-page-regions";
import { textInRegions } from "@/lib/practice/exam-extraction";
import { examDocument, type ExamPaper, type ExamQuestion, type ExamQuestionSecret } from "@/lib/practice/exam-questions";
import { recoverExamQuestionRegions } from "@/lib/practice/exam-sheet-recovery";
import { servableExamSetTexts, uniqueSetTextIn } from "@/lib/practice/exam-set-texts";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { readPageText } from "@/services/practice/exam-question-ingestion.server";

/**
 * Filing a literature question under the book it is answered on.
 *
 * A Literature paper prints one question per set text and a student answers
 * the one on theirs, so a question with no text recorded belongs to everybody
 * -- which is right for unseen poetry and wrong for Macbeth. Every question on
 * AQA 8702/1 was stored that way, because the text is matched against the
 * course's checked list and that list was not checked yet. Now that it is,
 * they can be filed without asking a model anything: the title is printed on
 * the paper, and most questions say it in their own wording.
 *
 * Two places are read, in order of how much they can be trusted.
 *
 * The question's own prompt comes first. "How does Shakespeare present Macbeth
 * as a disturbed character" names its text unambiguously, and ten of the
 * thirteen questions on 8702/1 do the same.
 *
 * The question's own region of the paper comes second, for the three that do
 * not -- a question whose text is named only in the heading above it. The
 * region is the one this question was cut from, recovered and proved the same
 * way the sheet backfill proves it, so this is not reading a neighbouring
 * question's heading by accident.
 *
 * Either way the match has to be unique. A passage naming two texts is a
 * passage that does not say which one the question is about, and a question
 * filed under the wrong book is hidden from every student who studies it --
 * a failure nobody would think to go looking for. Untagged is recoverable.
 */

export type ExamSetTextTagOutcome = {
  questionId: string;
  label: string;
  setTextId?: string;
  setTextLabel?: string;
  source?: "prompt" | "region";
  reason?: "ambiguous_or_absent" | "no_scheme" | "regions_unprovable";
};

export type ExamSetTextTaggingResult = {
  specificationId: string;
  scanned: number;
  tagged: number;
  untagged: ExamSetTextTagOutcome[];
  /** Everything written, so a run can be read back without a second query. */
  written: ExamSetTextTagOutcome[];
};

/**
 * Tag one specification's questions, optionally without writing anything.
 *
 * Papers are read one at a time and only when a question on them still needs
 * the region fallback, so a specification whose questions all name their own
 * text costs no PDF reads at all.
 */
export async function tagExamSetTexts(input: {
  specificationId: string;
  dryRun?: boolean;
}): Promise<ExamSetTextTaggingResult> {
  const catalogue = servableExamSetTexts(input.specificationId);
  if (catalogue.length === 0) {
    // Refused rather than skipped: every match would be undefined, so a run
    // would read the whole bank to write nothing.
    throw new Error("no_checked_set_text_list");
  }

  const db = getAdminDb();
  const snapshot = await db
    .collection("examQuestions")
    .where("origin", "==", "official_past_paper")
    .where("provenance.specificationId", "==", input.specificationId)
    .get();

  const questions = snapshot.docs
    .map((doc) => ({ ...doc.data(), id: doc.id }) as ExamQuestion)
    .filter((question) => !question.setTextId)
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));

  const result: ExamSetTextTaggingResult = {
    specificationId: input.specificationId,
    scanned: questions.length,
    tagged: 0,
    untagged: [],
    written: [],
  };

  /** Papers are read at most once, and only if something needs their pages. */
  const paperCache = new Map<
    string,
    { paper: ExamPaper; pages: Awaited<ReturnType<typeof readPageText>>; starts: ReturnType<typeof findQuestionStarts> } | null
  >();
  const readPaper = async (paperId: string) => {
    if (paperCache.has(paperId)) return paperCache.get(paperId) ?? null;
    let loaded = null;
    try {
      const paper = (await db.collection("examPapers").doc(paperId).get()).data() as
        | ExamPaper
        | undefined;
      if (paper?.questionPaperStoragePath) {
        const [bytes] = await getAdminStorageBucket()
          .file(paper.questionPaperStoragePath)
          .download();
        const pages = await readPageText(bytes);
        loaded = { paper, pages, starts: findQuestionStarts(pages) };
      }
    } catch {
      loaded = null;
    }
    paperCache.set(paperId, loaded);
    return loaded;
  };

  for (const question of questions) {
    const outcome: ExamSetTextTagOutcome = { questionId: question.id, label: question.label };

    let match = uniqueSetTextIn(catalogue, question.prompt);
    let source: ExamSetTextTagOutcome["source"] = "prompt";

    if (!match) {
      const loaded = await readPaper(question.paperId);
      const secret = loaded
        ? ((await db.collection("examQuestionSecrets").doc(question.id).get()).data() as
            | ExamQuestionSecret
            | undefined)
        : undefined;
      if (loaded && secret && secret.contentVersion === question.contentVersion) {
        const recovered = recoverExamQuestionRegions({
          contentVersion: question.contentVersion,
          prompt: question.prompt,
          marks: question.marks,
          markSchemeItem: secret.markSchemeItem,
          paperSha256: loaded.paper.questionPaperSha256,
          label: question.label,
          questionNumber: question.provenance.questionNumber,
          starts: loaded.starts,
          pages: loaded.pages,
          pageCount: loaded.pages.length,
        });
        if (recovered) {
          match = uniqueSetTextIn(catalogue, textInRegions(loaded.pages, recovered.regions));
          source = "region";
        } else {
          outcome.reason = "regions_unprovable";
        }
      } else if (loaded && !secret) {
        outcome.reason = "no_scheme";
      }
    }

    if (!match) {
      result.untagged.push({ ...outcome, reason: outcome.reason ?? "ambiguous_or_absent" });
      continue;
    }

    const written = { ...outcome, setTextId: match.id, setTextLabel: match.label, source };
    if (!input.dryRun) {
      await db
        .collection("examQuestions")
        .doc(question.id)
        .update(examDocument({ setTextId: match.id, updatedAt: Date.now() }));
    }
    result.tagged += 1;
    result.written.push(written);
  }

  return result;
}
