/**
 * Where a paper prints its figures, against the parts that cite them.
 *
 * A part is cropped from its own label to the next one, plus its question's
 * stem. A figure printed between two parts therefore falls inside the crop of
 * the part *before* the one that needs it: 8461/2H June 2022 09.5 asks about
 * Figure 14 and was rejected for showing Figure 13.
 *
 * This measures that rather than assuming it: for every part whose wording
 * cites a figure or table, it reports where the caption actually sits and
 * whether the part's own region reaches it.
 *
 *   node --env-file-if-exists=.env.local scripts/run-ts.mjs \
 *     scripts/eval/measure-question-figures.ts -- --url=<question paper pdf>
 */
import { readPageText } from "@/services/practice/exam-question-ingestion.server";
import {
  findQuestionStarts,
  regionsForQuestion,
  rootQuestionLabel,
  type PdfPageText,
  type QuestionRegion,
} from "@/lib/practice/exam-page-regions";

const DEFAULT_URL =
  "https://filestore.aqa.org.uk/sample-papers-and-mark-schemes/2022/june/AQA-84612H-QP-JUN22.PDF";

/** "Figure 14" / "Table 6", as printed in a caption or cited in the wording. */
const CITATION = /\b(Figure|Table)\s+(\d+)\b/gi;

/** Where each caption is printed, keyed by the name the wording would use. */
function captionPositions(pages: PdfPageText[]) {
  const found = new Map<string, { page: number; top: number }>();
  for (const page of pages) {
    for (const item of page.items) {
      for (const match of item.text.matchAll(CITATION)) {
        const key = `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2]}`;
        // The first printing is the caption; later ones are the wording citing it.
        if (!found.has(key)) found.set(key, { page: page.page, top: page.height - item.y });
      }
    }
  }
  return found;
}

/** Whether a region covers a point on the page. */
function covers(regions: readonly QuestionRegion[], at: { page: number; top: number }, pages: PdfPageText[]) {
  const height = pages.find((page) => page.page === at.page)?.height ?? 0;
  if (!height) return false;
  const ratio = at.top / height;
  return regions.some(
    (region) => region.page === at.page && ratio >= region.fromRatio && ratio <= region.toRatio
  );
}

export default async function main(args: string[] = []) {
  const url = args.find((arg) => arg.startsWith("--url="))?.slice(6) ?? DEFAULT_URL;
  // The ingestion's own reader, so what is measured is what it saw: it drops
  // whitespace runs and carries each item's height, and the label detection
  // depends on both.
  const pages = await readPageText(Buffer.from(await (await fetch(url)).arrayBuffer()));
  const starts = findQuestionStarts(pages);
  const captions = captionPositions(pages);
  console.log(`${pages.length} pages, ${starts.length} question starts, ${captions.size} captions\n`);

  let cited = 0;
  let missed = 0;
  let recovered = 0;
  for (const start of starts) {
    const root = rootQuestionLabel(start.label);
    const regions = regionsForQuestion({ label: start.label, starts, pages, withStemOf: root });
    if (regions.length === 0) continue;

    // What this part's own crop says, which is what the model was shown.
    const wording = pages
      .filter((page) => regions.some((region) => region.page === page.page))
      .flatMap((page) =>
        page.items
          .filter((item) => covers(regions, { page: page.page, top: page.height - item.y }, pages))
          .map((item) => item.text)
      )
      .join(" ");

    for (const match of new Set([...wording.matchAll(CITATION)].map((m) => `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`))) {
      const at = captions.get(match);
      if (!at) continue;
      cited += 1;
      if (covers(regions, at, pages)) continue;
      missed += 1;
      // The same crop asked for again, this time told what the part cites.
      const repaired = regionsForQuestion({
        label: start.label,
        starts,
        pages,
        withStemOf: root,
        wording,
      });
      const fixed = covers(repaired, at, pages);
      if (fixed) recovered += 1;
      console.log(
        `  ${start.label.padEnd(7)} cites ${match.padEnd(10)} printed p${at.page} top ${at.top.toFixed(0)}` +
          `  ${fixed ? "RECOVERED" : "still missing"}`
      );
    }
  }
  console.log(`\ncitations resolved: ${cited}, of which outside the crop: ${missed}, recovered: ${recovered}`);
}
