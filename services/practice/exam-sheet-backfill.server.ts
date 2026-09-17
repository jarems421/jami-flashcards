import "server-only";

import {
  answerSpacePagesAfter,
  findQuestionStarts,
  readSeparateAwardMarks,
  type PdfPageText,
  type QuestionStart,
} from "@/lib/practice/exam-page-regions";
import { textInRegions } from "@/lib/practice/exam-extraction";
import {
  EXAM_SHEET_MAX_PRINTED_PAGES,
  examSheetPageAssetId,
} from "@/lib/practice/exam-question-sheet";
import { examDocument, type ExamPaper, type ExamQuestion, type ExamQuestionSecret } from "@/lib/practice/exam-questions";
import { EXAM_PRINTED_QUESTION_ASSET_ID } from "@/lib/practice/exam-question-display";
import { recoverExamQuestionRegions } from "@/lib/practice/exam-sheet-recovery";
import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import {
  readPageText,
  renderQuestionSheet,
} from "@/services/practice/exam-question-ingestion.server";

/**
 * Giving the existing bank its pages, without re-extracting a single paper.
 *
 * The sheet a student writes on needs one image per page of the question's own
 * paper. Ingestion produces those now; the 1,500-odd questions ingested before
 * it did have only the stitched crop, so they fall back to the older layout.
 *
 * Re-ingesting them would work and would be a bad trade. `writeIngestionResults`
 * replaces a question document whole, and what it writes has no
 * `paperSpotCheckedAt` on it -- so every paper a person had sampled would go
 * back to unsampled, `isExamQuestionServable` would refuse the lot, and the
 * corpus would stay dark until somebody re-read 43 papers by hand. It would
 * also pay for extraction again, and extraction is a model: the wording it
 * returns the second time is not guaranteed to be the wording that was
 * reviewed the first time.
 *
 * Nothing about the pages needs a model. The board's PDF is kept beside the
 * paper, and where one question stops and the next begins is read off the PDF's
 * own text layer. So this re-derives the regions, proves they are the regions
 * the question was actually built from by reproducing its stored
 * `contentVersion`, and writes back exactly two fields. The version itself, the
 * review, the spot-check and every running session are untouched.
 *
 * A question whose version cannot be reproduced is not rendered and not
 * written. It is reported, and it keeps the layout it already had.
 */

export type ExamSheetBackfillSkip = {
  questionId: string;
  label: string;
  reason: "no_printed_crop" | "scheme_missing" | "render_failed";
  detail?: string;
};

export type ExamSheetBackfillResult = {
  paperId: string;
  /** Questions on this paper, in the order this walks them. */
  total: number;
  /** Where to resume, or null when the paper is done. */
  next: number | null;
  /** Repaginated from regions this proved it had recovered. */
  rendered: number;
  /**
   * Given the crop they already carry, as a single page, because their regions
   * could not be proved. See `reuseStitchedCrop`.
   */
  reused: number;
  alreadyDone: number;
  skipped: ExamSheetBackfillSkip[];
};

/** Papers with questions in the bank, oldest first, so a run is repeatable. */
export async function listExamSheetBackfillPapers(): Promise<
  Array<{ paperId: string; title: string; questions: number; withPages: number }>
> {
  const db = getAdminDb();
  const [papers, questions] = await Promise.all([
    db.collection("examPapers").get(),
    db.collection("examQuestions").select("paperId", "assets").get(),
  ]);
  const counts = new Map<string, { questions: number; withPages: number }>();
  for (const doc of questions.docs) {
    const data = doc.data() as Pick<ExamQuestion, "paperId" | "assets">;
    const entry = counts.get(data.paperId) ?? { questions: 0, withPages: 0 };
    entry.questions += 1;
    if (hasSheetPages(data.assets ?? [])) entry.withPages += 1;
    counts.set(data.paperId, entry);
  }
  return papers.docs
    .map((doc) => {
      const paper = doc.data() as ExamPaper;
      const entry = counts.get(doc.id) ?? { questions: 0, withPages: 0 };
      return {
        paperId: doc.id,
        title: [paper.board, paper.subject, paper.paperReference, `${paper.series} ${paper.year}`]
          .filter(Boolean)
          .join(" · "),
        ...entry,
      };
    })
    .filter((entry) => entry.questions > 0)
    .sort((left, right) => left.title.localeCompare(right.title));
}

function hasSheetPages(assets: readonly PracticePaperQuestionAsset[]) {
  return assets.some((asset) => /^question-page-\d+$/.test(asset.id));
}

/**
 * The sheet for a question whose regions cannot be proved: its own crop, whole.
 *
 * Roughly one question in fifty will not reproduce its stored version, because
 * the code that decides where a question starts and stops has been fixed
 * several times and some papers were ingested before those fixes. Today's
 * regions for those questions are not wrong -- they are mostly *better* -- but
 * they are not the regions the stored crop was cut from, and this is not the
 * place to quietly swap one for the other on a published, spot-checked
 * question.
 *
 * There is no need to. The crop those questions already carry is a picture of
 * their own paper, approved and sampled as it stands, and it is already served
 * to the student today. Pointing the sheet's one page at that very object
 * asserts nothing new: the same bytes, at the same path, now writable. What is
 * lost is only the pagination -- a two-page question arrives as one tall sheet
 * rather than two -- and a student who needs more room still has the extra
 * sheets behind it.
 */
function reuseStitchedCrop(
  crop: PracticePaperQuestionAsset,
  label: string
): PracticePaperQuestionAsset {
  return {
    ...crop,
    id: examSheetPageAssetId(0),
    title: "The question as printed",
    altText: `The paper as printed for ${label}`,
  };
}

/** The stitched crop's own object, which the page images are written beside. */
function printedCrop(question: ExamQuestion) {
  return question.assets?.find(
    (asset) => asset.id === EXAM_PRINTED_QUESTION_ASSET_ID && typeof asset.storagePath === "string"
  );
}

type PaperSource = {
  bytes: Buffer;
  pages: PdfPageText[];
  starts: QuestionStart[];
  sha256: string;
};

async function readPaperSource(paper: ExamPaper): Promise<PaperSource> {
  const path = paper.questionPaperStoragePath;
  if (!path) throw new Error("paper_source_missing");
  const [bytes] = await getAdminStorageBucket().file(path).download();
  const pages = await readPageText(bytes);
  return { bytes, pages, starts: findQuestionStarts(pages), sha256: paper.questionPaperSha256 };
}

/**
 * One bounded slice of one paper.
 *
 * Bounded because rendering a page of A4 at writing resolution is real work and
 * a paper can hold sixty questions. The caller comes back with `next` until it
 * is null, exactly as the ingestion job is walked.
 */
export async function backfillPaperSheets(input: {
  paperId: string;
  from?: number;
  limit?: number;
  /** Render again over pages this has already written, for a changed renderer. */
  force?: boolean;
}): Promise<ExamSheetBackfillResult> {
  const db = getAdminDb();
  const from = Math.max(0, Math.round(input.from ?? 0));
  const limit = Math.max(1, Math.min(8, Math.round(input.limit ?? 4)));

  const paperSnapshot = await db.collection("examPapers").doc(input.paperId).get();
  const paper = paperSnapshot.data() as ExamPaper | undefined;
  if (!paper) throw new Error("paper_not_found");

  const questionSnapshot = await db
    .collection("examQuestions")
    .where("paperId", "==", input.paperId)
    .get();
  // Sorted in memory rather than by the query, so the order is the same on
  // every call without the collection needing an index for it.
  const questions = questionSnapshot.docs
    .map((doc) => ({ ...doc.data(), id: doc.id }) as ExamQuestion)
    .sort((left, right) => left.id.localeCompare(right.id));

  const slice = questions.slice(from, from + limit);
  const result: ExamSheetBackfillResult = {
    paperId: input.paperId,
    total: questions.length,
    next: from + limit < questions.length ? from + limit : null,
    rendered: 0,
    reused: 0,
    alreadyDone: 0,
    skipped: [],
  };
  if (slice.length === 0) return { ...result, next: null };

  // Read once for the whole slice: the text layer of a forty-page paper is the
  // expensive part of this, and it is the same for every question on it.
  const source = await readPaperSource(paper);
  const bucket = getAdminStorageBucket();

  for (const question of slice) {
    if (!input.force && hasSheetPages(question.assets ?? [])) {
      result.alreadyDone += 1;
      continue;
    }
    const crop = printedCrop(question);
    if (!crop?.storagePath) {
      result.skipped.push({
        questionId: question.id,
        label: question.label,
        reason: "no_printed_crop",
      });
      continue;
    }

    const secretSnapshot = await db.collection("examQuestionSecrets").doc(question.id).get();
    const secret = secretSnapshot.data() as ExamQuestionSecret | undefined;
    if (!secret || secret.contentVersion !== question.contentVersion) {
      result.skipped.push({
        questionId: question.id,
        label: question.label,
        reason: "scheme_missing",
        detail: secret ? "The stored scheme is a different version of the question." : undefined,
      });
      continue;
    }

    const recovered = recoverExamQuestionRegions({
      contentVersion: question.contentVersion,
      prompt: question.prompt,
      marks: question.marks,
      markSchemeItem: secret.markSchemeItem,
      paperSha256: source.sha256,
      label: question.label,
      questionNumber: question.provenance.questionNumber,
      starts: source.starts,
      pages: source.pages,
      pageCount: source.pages.length,
    });
    if (!recovered) {
      // Not a failure, and not a guess either: the crop it already has, made
      // writable. See `reuseStitchedCrop`.
      if (!crop.width || !crop.height) {
        result.skipped.push({
          questionId: question.id,
          label: question.label,
          reason: "no_printed_crop",
          detail: "Its crop has no recorded size, so the sheet cannot be shaped from it.",
        });
        continue;
      }
      await db.collection("examQuestions").doc(question.id).update(
        examDocument({
          assets: [
            ...(question.assets ?? []).filter((asset) => !/^question-page-\d+$/.test(asset.id)),
            reuseStitchedCrop(crop, question.label),
          ],
          answerSpacePages: 0,
          updatedAt: Date.now(),
        })
      );
      result.reused += 1;
      continue;
    }

    try {
      const sheet = await renderQuestionSheet(source.bytes, recovered.regions);
      /*
       * The page images go beside the stitch, under its own path, so a paper
       * that is later re-ingested writes a fresh set rather than colliding with
       * these. The stitch's path already carries the content version, which the
       * recovery has just proved is the version these pages belong to.
       */
      const base = crop.storagePath.replace(/-question\.png$/, "");
      const pageAssets: PracticePaperQuestionAsset[] = [];
      for (const [index, page] of sheet.pages.entries()) {
        const path = `${base}-page-${index + 1}.png`;
        await bucket.file(path).save(page.bytes, { resumable: false, contentType: "image/png" });
        pageAssets.push({
          id: examSheetPageAssetId(index),
          type: "image",
          title:
            sheet.pages.length > 1
              ? `Page ${index + 1} of ${sheet.pages.length}, as printed`
              : "The page as printed",
          content: "",
          altText:
            sheet.pages.length > 1
              ? `Page ${index + 1} of ${sheet.pages.length} of the paper for ${question.label}`
              : `The paper as printed for ${question.label}`,
          storagePath: path,
          mimeType: "image/png",
          width: page.width,
          height: page.height,
          source: "deterministic",
          validationStatus: "valid",
        });
      }

      /*
       * The stitch is left exactly where it is.
       *
       * The new render would be a slightly cleaner one -- white where a page
       * used to come out transparent, and centred where a paper's pages are not
       * all one width -- but a session already running holds this path, and
       * changing the picture under a student mid-answer is the one thing the
       * version in that path exists to prevent. The pages are additive; the
       * stitch is not.
       */
      const answerSpacePages = answerSpacePagesAfter({
        label: recovered.startLabel,
        starts: [...source.starts],
        pages: source.pages,
      });
      /*
       * Read from the same region the pages were cut from, so a note printed
       * under a neighbouring question is not picked up as this one's.
       */
      const separateAwardMarks = readSeparateAwardMarks(
        textInRegions(source.pages, recovered.regions)
      );

      await db.collection("examQuestions").doc(question.id).update(
        examDocument({
          assets: [
            ...(question.assets ?? []).filter((asset) => !/^question-page-\d+$/.test(asset.id)),
            ...pageAssets,
          ],
          answerSpacePages,
          ...(separateAwardMarks ? { separateAwardMarks } : {}),
          updatedAt: Date.now(),
        })
      );
      /*
       * Pages a previous run wrote and this one did not.
       *
       * Re-rendering under a changed pagination -- joining an offcut to the
       * page it continues, say -- can leave a question with fewer pages than
       * it had, and the objects behind the ones it lost are then referenced by
       * nothing. Removed after the write, so a failure here leaves dead files
       * rather than a question pointing at missing ones.
       */
      for (let index = pageAssets.length; index < EXAM_SHEET_MAX_PRINTED_PAGES; index += 1) {
        await bucket
          .file(`${base}-page-${index + 1}.png`)
          .delete({ ignoreNotFound: true })
          .catch(() => undefined);
      }
      result.rendered += 1;
    } catch (error) {
      result.skipped.push({
        questionId: question.id,
        label: question.label,
        reason: "render_failed",
        detail: error instanceof Error ? error.message : undefined,
      });
    }
  }

  return result;
}
