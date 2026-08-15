import type { MarkingCorpusRecord } from "@/lib/evaluation/marking-corpus";

/**
 * Parser for `aqa-alevel-english`.
 *
 * Saved AQA resource pages, each holding one exemplar A-level English
 * Literature essay together with the examiner's commentary on it. Four of the
 * five pages are exemplars; the fifth is the teaching guide that indexes them.
 *
 * Small, and worth having anyway. The four essays sit at bands 2, 3, 4 and 5 of
 * the same specification, so together they say what separates a middling essay
 * from a top one — which no amount of marked work at a single standard can
 * teach. The commentary is broken down objective by objective, which is the
 * shape of reasoning Jami has to produce rather than just the number.
 *
 * These pages award a band, not a mark out of the paper's total. Recording the
 * band as though it were a mark would misstate the scale, so `maxMarks` is the
 * number of bands and the unit is said plainly here: a record from this source
 * means "the examiner placed this in band N of 5".
 */

const BANDS = 5;

/** Text this source repeats on every page, which is not part of the marking. */
const BOILERPLATE = [
  /^This resource is part of the .*resource package\s*\.?$/i,
  /^An exemplar student response to .*$/i,
  /^An example student response to .*$/i,
];

export type AqaPage = { name: string; html: string };

export type AqaResult = {
  records: MarkingCorpusRecord[];
  issues: string[];
  stats: {
    pages: number;
    ingested: number;
    /** Pages carrying no exemplar, such as the teaching guide. */
    withoutResponse: number;
    bands: Record<string, number>;
    withObjectiveCommentary: number;
  };
};

type Block = { heading: string | null; text: string };

/**
 * The page as a flat run of headings and paragraphs.
 *
 * These pages wrap about ten kilobytes of real content in two hundred of site
 * furniture, so the content region is found first and everything outside it is
 * discarded before any of it is read.
 */
export function readAqaBlocks(html: string): Block[] {
  const start = html.indexOf("web-resource-content");
  const region = start >= 0 ? html.slice(start) : html;
  const end = region.indexOf("Specifications that use this resource");
  const content = end >= 0 ? region.slice(0, end) : region;

  const cleaned = content
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const blocks: Block[] = [];
  const pattern = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of cleaned.matchAll(pattern)) {
    const text = decodeHtml(match[2].replace(/<[^>]+>/g, " "));
    if (!text) continue;
    blocks.push({ heading: /^h[1-6]$/i.test(match[1]) ? text : null, text });
  }
  return blocks;
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const isBoilerplate = (text: string) => BOILERPLATE.some((pattern) => pattern.test(text));

/**
 * Group the blocks under the heading that introduces them.
 *
 * Heading level is deliberately ignored: one of the four pages nests the same
 * sections a level deeper than the rest, and matching on the heading's words is
 * what actually identifies a section.
 */
function sectionsOf(blocks: Block[]) {
  const sections: { heading: string; body: string[] }[] = [];
  for (const block of blocks) {
    if (block.heading !== null) {
      sections.push({ heading: block.heading, body: [] });
      continue;
    }
    if (isBoilerplate(block.text)) continue;
    if (sections.length > 0) sections[sections.length - 1].body.push(block.text);
  }
  return sections;
}

/** The examiner's closing placement, which also states the band independently. */
const PLACEMENT = /consistent with the band (\d+) descriptors/i;

export function parseAqaAlevelEnglish(input: { pages: readonly AqaPage[] }): AqaResult {
  const records: MarkingCorpusRecord[] = [];
  const issues: string[] = [];
  const bands: Record<string, number> = {};
  let withoutResponse = 0;
  let withObjectiveCommentary = 0;

  for (const page of input.pages) {
    const sections = sectionsOf(readAqaBlocks(page.html));

    const responseSection = sections.find((section) => /^band\s+(\d+)\s+response$/i.test(section.heading));
    if (!responseSection) {
      // The teaching guide indexes the exemplars but contains none itself.
      withoutResponse += 1;
      continue;
    }

    const band = Number(/^band\s+(\d+)\s+response$/i.exec(responseSection.heading)![1]);
    if (!Number.isFinite(band) || band < 1 || band > BANDS) {
      issues.push(`${page.name}: band ${band} is outside 1..${BANDS}; skipped.`);
      continue;
    }

    const answer = responseSection.body.join("\n\n").trim();
    if (!answer) {
      issues.push(`${page.name}: band ${band} heading with no response beneath it; skipped.`);
      continue;
    }

    const questionSection = sections.find((section) => /sample question/i.test(section.heading));
    const prompt = (questionSection?.body ?? []).join("\n").trim();
    if (!prompt) issues.push(`${page.name}: no sample question found; the record carries none.`);

    // Everything from the commentary heading onward is the examiner speaking:
    // an overall judgement, then one paragraph per assessment objective.
    const commentaryStart = sections.findIndex((section) => /examiner commentary/i.test(section.heading));
    const commentaryParts: string[] = [];
    let placementBand: number | null = null;

    let placementText: string | null = null;
    if (commentaryStart >= 0) {
      for (const section of sections.slice(commentaryStart)) {
        const label = /^AO\d$/i.test(section.heading) ? `${section.heading.toUpperCase()}: ` : "";
        if (label) withObjectiveCommentary += 1;
        for (const paragraph of section.body) {
          const placement = PLACEMENT.exec(paragraph);
          if (placement) {
            // The closing placement judges the whole response. It trails the
            // last objective on the page, so labelling it by position would
            // file the examiner's overall verdict under AO5.
            placementBand = Number(placement[1]);
            placementText = paragraph;
            continue;
          }
          commentaryParts.push(`${label}${paragraph}`);
        }
      }
    }
    if (placementText) commentaryParts.push(placementText);

    if (placementBand !== null && placementBand !== band) {
      issues.push(
        `${page.name}: heading says band ${band} but the examiner places it in band ${placementBand}; used the heading.`
      );
    }

    bands[String(band)] = (bands[String(band)] ?? 0) + 1;
    records.push({
      id: `aqa:${page.name.replace(/\.html?$/i, "")}`,
      sourceId: "aqa-alevel-english",
      level: "alevel",
      subject: "english",
      // Placed against level descriptors as a whole, with the objectives
      // discussed rather than scored one by one.
      regime: "banded",
      questionId: page.name.replace(/\.html?$/i, ""),
      questionPrompt: prompt,
      answer: { kind: "text", text: answer },
      humanMarks: [band],
      maxMarks: BANDS,
      ...(commentaryParts.length > 0 ? { examinerCommentary: commentaryParts.join("\n") } : {}),
    });
  }

  return {
    records,
    issues,
    stats: {
      pages: input.pages.length,
      ingested: records.length,
      withoutResponse,
      bands,
      withObjectiveCommentary,
    },
  };
}
