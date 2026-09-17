/**
 * Why a question's stored version cannot be reproduced.
 *
 * The backfill refuses any question it cannot prove, which is right and also
 * silent about the reason. This takes the refusals apart: for each one it says
 * what the paper's margin labels are, what regions today's code derives, and
 * what the stored crop's own dimensions say the original regions must have
 * been -- because the stitch's width and height are arithmetic on the regions
 * it was cut from, and that is a second, independent way to recognise them.
 *
 * Reads and computes only. Renders nothing, writes nothing, calls no model.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs scripts/eval/sheet-backfill-diagnose.ts
 */
import {
  findQuestionStarts,
  normaliseQuestionLabel,
  regionsForQuestion,
  rootQuestionLabel,
  type PdfPageText,
  type QuestionRegion,
} from "@/lib/practice/exam-page-regions";
import { examQuestionContentVersion } from "@/lib/practice/exam-content-version";
import { recoverExamQuestionRegions } from "@/lib/practice/exam-sheet-recovery";
import type { ExamPaper, ExamQuestion, ExamQuestionSecret } from "@/lib/practice/exam-questions";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";
import { readPageText } from "@/services/practice/exam-question-ingestion.server";

/** The scale the stitched crop was, and still is, rendered at. */
const EXTRACT_SCALE = 1.7;

/**
 * The size the old renderer would have produced for a set of regions.
 *
 * `renderRegions` rendered each region's page at 1.7, cut `ceil(height * span)`
 * pixels out of it, and stacked them left-aligned on a canvas as wide as the
 * widest. None of that needs a renderer to predict -- it is arithmetic on the
 * page sizes in the text layer, which is what makes the stored asset's own
 * width and height a fingerprint of the regions behind it.
 */
function predictedExtractSize(regions: QuestionRegion[], pages: PdfPageText[]) {
  let width = 0;
  let height = 0;
  for (const region of regions) {
    const page = pages.find((entry) => entry.page === region.page);
    if (!page) return null;
    const canvasWidth = Math.ceil(page.width * EXTRACT_SCALE);
    const canvasHeight = Math.ceil(page.height * EXTRACT_SCALE);
    width = Math.max(width, canvasWidth);
    height += Math.max(1, Math.ceil((region.toRatio - region.fromRatio) * canvasHeight));
  }
  return regions.length ? { width, height } : null;
}

/** The same, for the whole-page fallback a question with no region got. */
function predictedPageSize(pageNumber: number, pages: PdfPageText[]) {
  const page = pages.find((entry) => entry.page === pageNumber);
  if (!page) return null;
  return {
    width: Math.ceil(page.width * EXTRACT_SCALE),
    height: Math.ceil(page.height * EXTRACT_SCALE),
  };
}

export default async function main() {
  const db = getAdminDb();
  const bucket = getAdminStorageBucket();
  const [papers, questions, secrets] = await Promise.all([
    db.collection("examPapers").get(),
    db.collection("examQuestions").get(),
    db.collection("examQuestionSecrets").get(),
  ]);
  const schemes = new Map(secrets.docs.map((doc) => [doc.id, doc.data() as ExamQuestionSecret]));
  const byPaper = new Map<string, ExamQuestion[]>();
  for (const doc of questions.docs) {
    const question = { ...doc.data(), id: doc.id } as ExamQuestion;
    byPaper.set(question.paperId, [...(byPaper.get(question.paperId) ?? []), question]);
  }

  const reasons = new Map<string, number>();
  const note = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  /*
   * The control. A prediction that cannot reproduce the size of a crop whose
   * regions are already proved is a broken prediction, and every verdict below
   * that rests on it would be worthless. So it is measured on the questions
   * that do prove, before it is trusted on the ones that do not.
   */
  let controlChecked = 0;
  let controlMatched = 0;
  /** How far off the question's OWN label lands, for each refusal. */
  const anchoredDeltas: Array<{ id: string; delta: number; samePages: boolean }> = [];

  for (const doc of papers.docs) {
    const paper = { ...doc.data(), id: doc.id } as ExamPaper;
    const mine = byPaper.get(doc.id) ?? [];
    if (!mine.length) continue;
    let pages: PdfPageText[];
    try {
      const [bytes] = await bucket.file(paper.questionPaperStoragePath).download();
      pages = await readPageText(bytes);
    } catch {
      continue;
    }
    const starts = findQuestionStarts(pages);

    for (const question of mine) {
      const secret = schemes.get(question.id);
      if (!secret || secret.contentVersion !== question.contentVersion) continue;
      const proved = recoverExamQuestionRegions({
        contentVersion: question.contentVersion,
        prompt: question.prompt,
        marks: question.marks,
        markSchemeItem: secret.markSchemeItem,
        paperSha256: paper.questionPaperSha256,
        label: question.label,
        questionNumber: question.provenance.questionNumber,
        starts,
        pages,
        pageCount: pages.length,
      });
      const cropAsset = question.assets?.find((asset) => asset.id === "question-extract");
      if (proved) {
        if (cropAsset?.width && cropAsset?.height) {
          const size = predictedExtractSize(proved.regions, pages);
          controlChecked += 1;
          if (size && size.width === cropAsset.width && size.height === cropAsset.height) {
            controlMatched += 1;
          }
        }
        continue;
      }

      const crop = cropAsset;
      const stored = crop?.width && crop?.height ? { width: crop.width, height: crop.height } : null;

      console.log(`\n${paper.paperReference} ${question.label}  (${question.id})`);
      console.log(`  questionNumber       ${question.provenance.questionNumber}`);
      console.log(`  stored crop          ${stored ? `${stored.width}x${stored.height}` : "none"}`);
      console.log(`  status/review        ${question.status} / ${question.review?.status}`);

      /*
       * The empty-region case. A question whose region could not be located at
       * ingestion was stored as a render of its whole page, and hashed with an
       * empty region list -- a candidate the recovery never tries, because an
       * empty list is not a crop.
       */
      let wholePage: number | null = null;
      for (let page = 1; page <= pages.length; page += 1) {
        const version = examQuestionContentVersion({
          prompt: question.prompt,
          marks: question.marks,
          markSchemeItem: secret.markSchemeItem,
          page,
          regions: [],
          paperSha256: paper.questionPaperSha256,
        });
        if (version === question.contentVersion) {
          wholePage = page;
          break;
        }
      }
      if (wholePage !== null) {
        const size = predictedPageSize(wholePage, pages);
        console.log(
          `  VERDICT              whole page ${wholePage} (no region was located at ingestion)`
        );
        console.log(
          `  geometry             predicted ${size?.width}x${size?.height}` +
            `${stored && size && size.width === stored.width && size.height === stored.height ? "  MATCHES stored" : "  does not match stored"}`
        );
        note("stored as a whole page");
        continue;
      }

      // Otherwise: show what today's code derives, and how far off it is.
      const candidates = new Set<string>();
      for (const start of starts) candidates.add(start.label);
      let geometryMatch = "";
      const near: Array<{ label: string; size: string; delta: number; span: string }> = [];
      for (const label of candidates) {
        const root = rootQuestionLabel(label);
        for (const withStem of root && root !== label ? [false, true] : [false]) {
          const regions = regionsForQuestion({
            label,
            starts,
            pages,
            ...(withStem ? { withStemOf: root } : {}),
          });
          const size = predictedExtractSize(regions, pages);
          if (!size) continue;
          if (stored && size.width === stored.width && size.height === stored.height) {
            geometryMatch = `${label}${withStem ? " +stem" : ""} -> ${regions
              .map((region) => `p${region.page}`)
              .join(",")}`;
          }
          if (stored) {
            near.push({
              label: `${label}${withStem ? " +stem" : ""}`,
              size: `${size.width}x${size.height}`,
              delta: Math.abs(size.height - stored.height),
              span: regions.map((region) => `p${region.page}:${region.fromRatio.toFixed(3)}-${region.toRatio.toFixed(3)}`).join(" "),
            });
          }
        }
      }
      /*
       * The one candidate that is anchored to this question rather than found
       * by search: the margin label its own stored number normalises to. If
       * the crop moved, this is what it moved from.
       */
      const ownLabel = (() => {
        const normalised = normaliseQuestionLabel(question.provenance.questionNumber);
        if (normalised && candidates.has(normalised)) return normalised;
        const fromLabel = normaliseQuestionLabel(question.label);
        if (fromLabel && candidates.has(fromLabel)) return fromLabel;
        const root = rootQuestionLabel(question.provenance.questionNumber);
        return candidates.has(root) ? root : null;
      })();
      if (ownLabel && stored) {
        const root = rootQuestionLabel(ownLabel);
        let best: { delta: number; span: string } | null = null;
        for (const withStem of root && root !== ownLabel ? [false, true] : [false]) {
          const regions = regionsForQuestion({
            label: ownLabel,
            starts,
            pages,
            ...(withStem ? { withStemOf: root } : {}),
          });
          const size = predictedExtractSize(regions, pages);
          if (!size || size.width !== stored.width) continue;
          const delta = Math.abs(size.height - stored.height);
          if (!best || delta < best.delta) {
            best = {
              delta,
              span: regions.map((region) => `p${region.page}`).join(","),
            };
          }
        }
        if (best) {
          console.log(`  own label            ${ownLabel} off by ${best.delta}px (${best.span})`);
          anchoredDeltas.push({ id: question.id, delta: best.delta, samePages: true });
        } else {
          console.log(`  own label            ${ownLabel} — no candidate of the stored width`);
          anchoredDeltas.push({ id: question.id, delta: Number.POSITIVE_INFINITY, samePages: false });
        }
      } else {
        console.log(`  own label            not found among the margin labels`);
        anchoredDeltas.push({ id: question.id, delta: Number.POSITIVE_INFINITY, samePages: false });
      }
      console.log(`  margin labels        ${starts.length} found`);
      for (const entry of near.sort((left, right) => left.delta - right.delta).slice(0, 3)) {
        console.log(
          `  candidate ${entry.label.padEnd(12)} ${entry.size.padEnd(12)} off by ${entry.delta}`
        );
        console.log(`      ${entry.span}`);
      }
      if (geometryMatch) {
        console.log(`  VERDICT              region logic changed since ingestion`);
        console.log(`  geometry             stored image matches ${geometryMatch}`);
        note("region logic changed, geometry still identifiable");
      } else {
        console.log(`  VERDICT              nothing today reproduces it`);
        note("unexplained");
      }
    }
  }

  console.log(
    `\nGeometry control: ${controlMatched}/${controlChecked} proved crops predicted exactly\n`
  );
  const finite = anchoredDeltas.filter((entry) => Number.isFinite(entry.delta));
  console.log("How far the question's own label lands from its stored crop:\n");
  const buckets = new Map<string, number>();
  for (const entry of anchoredDeltas) {
    const key = !Number.isFinite(entry.delta)
      ? "no candidate"
      : entry.delta === 0
        ? "exact"
        : entry.delta <= 4
          ? "1-4px"
          : entry.delta <= 24
            ? "5-24px (a headroom)"
            : entry.delta <= 100
              ? "25-100px"
              : "over 100px";
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  for (const [key, count] of buckets) console.log(`  ${String(count).padStart(4)}  ${key}`);
  if (finite.length) {
    const sorted = finite.map((entry) => entry.delta).sort((left, right) => left - right);
    console.log(
      `\n  min ${sorted[0]}  median ${sorted[Math.floor(sorted.length / 2)]}  max ${sorted[sorted.length - 1]}\n`
    );
  }
  console.log("Why they refuse:\n");
  for (const [reason, count] of [...reasons].sort((left, right) => right[1] - left[1])) {
    console.log(`  ${String(count).padStart(4)}  ${reason}`);
  }
}
