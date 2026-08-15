import type { MarkingCorpusRecord, MarkingRegime } from "@/lib/evaluation/marking-corpus";
import type { PdfPageText } from "./pdf-text.ts";

/**
 * Parser for `pearson-alevel` — International A-level Economics exemplars.
 *
 * Real candidate responses to the June 2019 papers, each with the examiner's
 * written rationale for the mark. It is the first source in the corpus marked
 * by assessment objective — knowledge, application, analysis, evaluation — and
 * that is why it is worth more than its thirty-odd records suggest: every other
 * essay-length source in the corpus is a single band judgement, and none of
 * them shows an examiner reasoning about *which* skill earned the credit.
 *
 * Answer-level, not criterion-level, and deliberately so. Qualifications
 * Scotland writes one bullet per mark; Pearson writes paragraphs. A handful of
 * responses do break the total into strand scores — "Knowledge as well as
 * Application and Analysis show a weak Level 3 ... scores 9" — but only a
 * handful, and inferring a strand split from prose that usually does not
 * contain one would manufacture structure the examiner never wrote. The prose
 * is kept whole instead, where the reasoning actually lives.
 *
 * The one thing this source cannot supply is the tariff. Question papers and
 * mark schemes are reproduced as page images with no text layer, and nothing in
 * the booklets states what any question was out of. `maxMarks` is therefore the
 * highest mark any exemplar of that question actually received — a demonstrated
 * lower bound, never a claim about the paper. Every question is flagged for it.
 * Supplying the WEC11 June 2019 question papers would fix it outright.
 */

/** Repeated on every page of the booklets, and never part of a response. */
const FOOTER =
  /Pearson Edexcel International Advanced (Subsidiary\/Advanced Level|Level|Subsidiary) in Economics Unit \d+ [-–] Exemplar materials|Issue \d+ [-–] \w+ \d{4} © Pearson Education Limited \d{4}/g;

/** `Question 12(c)`, but not the contents line `Question 12(c) 23`. */
const QUESTION_HEADING = /^Question (\d+)\s*(\([a-z]\))?$/;
const RESPONSE_HEADING = /^Exemplar response ([A-Z])$/;
const COMMENTS_HEADING = /^Examiner['’]s comments:?$/;
const MARK_AWARDED = /This response was (?:given|awarded) (\d+) marks?/i;

export type PearsonUnit = {
  /** Short identifier used in record ids, e.g. `unit-1`. */
  id: string;
  pages: readonly PdfPageText[];
  /** Path to the booklet, for referencing the response images. */
  file: string;
};

export type PearsonResult = {
  records: MarkingCorpusRecord[];
  issues: string[];
  stats: {
    responsesFound: number;
    ingested: number;
    questions: number;
    withoutMark: number;
    byRegime: Record<string, number>;
    /** Questions whose maximum is a lower bound taken from the exemplars. */
    tariffFromExemplars: number;
  };
};

const stripFooters = (text: string) => text.replace(FOOTER, "\n");

type Section = { question: string; label: string; firstPage: number; commentary: string[] };

/**
 * Walk a booklet into one section per exemplar response.
 *
 * The contents page repeats every heading with a page number after it, so
 * headings are matched only in their bare form — `Question 12(c)` counts,
 * `Question 12(c) 23` does not.
 */
export function readPearsonSections(pages: readonly PdfPageText[]) {
  const sections: Section[] = [];
  let question: string | null = null;
  let collecting = false;

  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    for (const raw of stripFooters(page.text).split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line) continue;

      const questionHeading = QUESTION_HEADING.exec(line);
      if (questionHeading) {
        question = `${questionHeading[1]}${(questionHeading[2] ?? "").replace(/[()]/g, "")}`;
        collecting = false;
        continue;
      }

      const responseHeading = RESPONSE_HEADING.exec(line);
      if (responseHeading && question) {
        sections.push({ question, label: responseHeading[1], firstPage: page.page, commentary: [] });
        collecting = false;
        continue;
      }

      if (COMMENTS_HEADING.test(line)) {
        collecting = sections.length > 0;
        continue;
      }

      // A bare page number is furniture the footer pattern leaves behind.
      if (collecting && !/^\d+$/.test(line)) {
        sections[sections.length - 1].commentary.push(line);
      }
    }
  }
  return sections;
}

/**
 * Which regime the examiner used, read from how they wrote about the marks.
 *
 * Levels language means the response was placed against level descriptors for
 * each assessment objective strand; otherwise individual marks were credited
 * one at a time, and the commentary names them as knowledge or application
 * marks.
 */
function regimeFor(commentary: string): MarkingRegime {
  return /\blevel\s*\d/i.test(commentary) ? "weightedTraits" : "additive";
}

export function parsePearsonAlevel(input: { units: readonly PearsonUnit[] }): PearsonResult {
  const records: MarkingCorpusRecord[] = [];
  const issues: string[] = [];
  const byRegime: Record<string, number> = {};
  let responsesFound = 0;
  let withoutMark = 0;

  for (const unit of input.units) {
    const sections = readPearsonSections(unit.pages);
    responsesFound += sections.length;

    const scored: { section: Section; mark: number; commentary: string }[] = [];
    for (const section of sections) {
      const commentary = section.commentary.join(" ").replace(/\s+/g, " ").trim();
      const awarded = MARK_AWARDED.exec(commentary);
      if (!awarded) {
        withoutMark += 1;
        issues.push(
          `${unit.id} question ${section.question} response ${section.label}: the commentary states no mark; skipped.`
        );
        continue;
      }
      scored.push({ section, mark: Number(awarded[1]), commentary });
    }

    // Nothing in the booklet says what a question was out of, so the best
    // evidenced answer is the highest mark an exemplar of it actually got.
    const lowerBound = new Map<string, number>();
    for (const { section, mark } of scored) {
      lowerBound.set(section.question, Math.max(lowerBound.get(section.question) ?? 0, mark));
    }

    for (const { section, mark, commentary } of scored) {
      const maxMarks = lowerBound.get(section.question) ?? mark;
      const regime = regimeFor(commentary);
      byRegime[regime] = (byRegime[regime] ?? 0) + 1;

      records.push({
        id: `pearson:${unit.id}:q${section.question}:${section.label}`,
        sourceId: "pearson-alevel",
        level: "alevel",
        subject: "economics",
        regime,
        questionId: `q${section.question}`,
        // The question is reproduced as a page image with no text layer.
        questionPrompt: "",
        answer: { kind: "image", paths: [`${unit.file}#page=${section.firstPage}`] },
        humanMarks: [mark],
        maxMarks,
        examinerCommentary: commentary,
      });
    }

    for (const [question, bound] of lowerBound) {
      issues.push(
        `${unit.id} question ${question}: nothing states the tariff, so it is recorded out of ${bound}, the highest mark an exemplar received.`
      );
    }
  }

  return {
    records,
    issues,
    stats: {
      responsesFound,
      ingested: records.length,
      // Both units number their questions from 7, so a question is only
      // identified by its unit and number together.
      questions: new Set(records.map((record) => record.id.split(":").slice(1, 3).join(":"))).size,
      withoutMark,
      byRegime,
      tariffFromExemplars: new Set(records.map((record) => record.id.split(":").slice(1, 3).join(":"))).size,
    },
  };
}
