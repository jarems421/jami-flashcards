import type { MarkingCorpusRecord, MarkingCriterion } from "@/lib/evaluation/marking-corpus";
import type { PdfPageText } from "./pdf-text";

/**
 * SQA coursework assignments, which are the only typed work the corpus holds.
 *
 * Every other criterion-level record is a photograph of handwriting, and that
 * makes two explanations of Jami's generosity impossible to separate by
 * measurement: it may misread the work, or it may read it correctly and misjudge
 * it. Telling those apart has meant reading scripts by hand, which does not
 * scale, and it has left five failed experiments without a clean interpretation.
 *
 * These assignments are typed. The evidence is still an image -- the PDFs carry
 * only page furniture in their text layer -- but it is a clean scan of printed
 * text rather than somebody's handwriting, and a vision model reads print
 * essentially perfectly. If Jami marks these as generously as it marks
 * handwriting, then reading was never the problem.
 *
 * Three commentary forms, because SQA changed the format and the two subjects
 * differ. All three end in the same place: a mark per section, and a stated
 * total to check them against.
 */

/** One section of an assignment, as the examiner scored it. */
export type AssignmentSection = {
  /** Normalised across years, since 2015 and 2023 name the same thing differently. */
  name: string;
  awarded: number;
};

export type AssignmentAward = {
  sections: AssignmentSection[];
  /** The examiner's own total, used to check the sections rather than to replace them. */
  total: number;
};

/**
 * Page furniture, which lands in the middle of the text rather than after it.
 *
 * The extractor emits the footer wherever it sits on the page, so a section list
 * that spans a page break has a footer inside it. The Qualifications Scotland
 * parser learned this the hard way; here it would swallow the last section of
 * every candidate whose summary crosses a page.
 */
const FOOTER =
  /\s*(Higher\s+)?(Modern Studies|Psychology)\s+Higher\s+Assignment\s+\d{4}\s*(Commentaries|Commentary)[^]*?(understandingstandards\.org\.uk\s*\d+\s*of\s*\d+|Candidate\s+\d+\s+\d+)/gi;

const stripFurniture = (text: string) =>
  text
    .replace(FOOTER, " ")
    .replace(/Higher\s+(Modern Studies|Psychology)\s+Assignment\s+\d{4}[^.]{0,80}?\d+\s*of\s*\d+/gi, " ")
    // Footnote markers on a mark, e.g. "5 marks*", which are not part of it.
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ");

/**
 * What each section is called, whatever the year called it.
 *
 * 2015 writes "Analysis/Synthesis" where 2023 writes "B: Analysing and
 * synthesising". They are the same section and must compare as one, or a record
 * from either year cannot be scored against the other.
 */
const MODERN_STUDIES_SECTIONS: Record<string, string> = {
  a: "Knowledge and understanding",
  knowledge: "Knowledge and understanding",
  b: "Analysing and synthesising",
  "analysis/synthesis": "Analysing and synthesising",
  c: "Source evaluation",
  "source evaluation": "Source evaluation",
  d: "Structure",
  structure: "Structure",
  e: "Reaching a decision",
  decision: "Reaching a decision",
};

/**
 * The current form: a closing summary naming each section and its mark.
 *
 *   Overall, the candidate was awarded 14 out of 30 marks for their assignment:
 *   A: Knowledge and understanding: 10 marks  B: Analysing and synthesising: 0
 *   marks  C: Source evaluation: 0 marks  D: Structure: 2 marks
 *   E: Reaching a decision: 2 marks
 *
 * "marks" is sometimes "mark", "out of 30 marks" is sometimes "out of 30", and a
 * section is sometimes simply absent -- one 2024 candidate lists four sections
 * against a stated total of 24, leaving three marks unexplained. The caller
 * decides what to do about that; this only reports what is there.
 */
export function readModernStudiesSummary(text: string): AssignmentAward | null {
  const clean = stripFurniture(text);
  const overall = /the candidate was awarded\s+(\d+)\s*(?:out of|\/)\s*30\b/i.exec(clean);
  if (!overall) return null;

  const sections: AssignmentSection[] = [];
  const entry = /\b([A-E])\s*:\s*([A-Za-z ]+?)\s*:\s*(\d+)\s*marks?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(clean.slice(overall.index))) !== null) {
    const name = MODERN_STUDIES_SECTIONS[match[1].toLowerCase()];
    if (name) sections.push({ name, awarded: Number(match[3]) });
  }
  return sections.length > 0 ? { sections, total: Number(overall[1]) } : null;
}

/**
 * The 2015 form, which lists the sections as bare name-number pairs before the
 * total:
 *
 *   Knowledge 2 Analysis/Synthesis 3 Source Evaluation 0 Structure 1 Decision 1
 *   The candidate was awarded 7/30 marks for this Assignment.
 */
export function readLegacyModernStudiesSummary(text: string): AssignmentAward | null {
  const clean = stripFurniture(text);
  const overall = /the candidate was awarded\s+(\d+)\s*\/\s*30\s*marks/i.exec(clean);
  if (!overall) return null;

  const sections: AssignmentSection[] = [];
  const entry =
    /\b(Knowledge|Analysis\/Synthesis|Source Evaluation|Structure|Decision)\s+(\d+)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(clean.slice(0, overall.index))) !== null) {
    const name = MODERN_STUDIES_SECTIONS[match[1].toLowerCase()];
    // The same label can appear in the prose above the summary, so the last
    // occurrence wins -- the summary is always the final one.
    if (!name) continue;
    const existing = sections.findIndex((section) => section.name === name);
    if (existing >= 0) sections[existing] = { name, awarded: Number(match[2]) };
    else sections.push({ name, awarded: Number(match[2]) });
  }
  return sections.length > 0 ? { sections, total: Number(overall[1]) } : null;
}

/**
 * Psychology, which names its sections by letter and states each award:
 *
 *   The candidate achieved 32 marks for this course assessment component.
 *   Section A The candidate was awarded 8 marks because ...
 *   Section B The candidate was awarded 2 marks because ...
 *
 * Self-checking in a way the Modern Studies form is not: the sections sum to the
 * stated total exactly.
 */
export function readPsychologySections(text: string): AssignmentAward | null {
  const clean = stripFurniture(text);
  const overall = /the candidate achieved\s+(\d+)\s*marks/i.exec(clean);
  if (!overall) return null;

  const sections: AssignmentSection[] = [];
  const entry = /\bSection\s+([A-H])\b[^.]{0,80}?was awarded\s+(\d+)\s*marks?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(clean)) !== null) {
    const name = `Section ${match[1].toUpperCase()}`;
    if (!sections.some((section) => section.name === name)) {
      sections.push({ name, awarded: Number(match[2]) });
    }
  }
  return sections.length > 0 ? { sections, total: Number(overall[1]) } : null;
}

export type SqaAssignmentCandidate = {
  /** Number within its series, used in the record id and to find the evidence. */
  candidate: number;
  /** The commentary text for this candidate alone. */
  text: string;
  /** Path plus page range of the candidate's scanned assignment. */
  evidence: string;
};

export type SqaAssignmentSeries = {
  /** e.g. `2023`. */
  id: string;
  form: "modernStudies" | "modernStudiesLegacy" | "psychology";
  candidates: readonly SqaAssignmentCandidate[];
};

export type SqaAssignmentInput = {
  sourceId: string;
  subject: string;
  /**
   * The whole assignment's tariff where the payload states it, e.g. 30 for
   * Modern Studies. Left out where it does not: Higher Psychology publishes no
   * total anywhere in this material, and asserting one would be a guess wearing
   * a number's clothes. Omitted, it is summed from the section ceilings and is
   * a floor like they are.
   */
  maxMarks?: number;
  series: readonly SqaAssignmentSeries[];
};

export type SqaAssignmentResult = {
  records: MarkingCorpusRecord[];
  issues: string[];
  stats: {
    candidates: number;
    ingested: number;
    criteria: number;
    /** Candidates whose sections did not add up to the examiner's own total. */
    unbalanced: number;
    unreadable: number;
  };
};

const READERS = {
  modernStudies: readModernStudiesSummary,
  modernStudiesLegacy: readLegacyModernStudiesSummary,
  psychology: readPsychologySections,
} as const;

export function parseSqaAssignment(input: SqaAssignmentInput): SqaAssignmentResult {
  const records: MarkingCorpusRecord[] = [];
  const issues: string[] = [];
  let candidates = 0;
  let unbalanced = 0;
  let unreadable = 0;

  for (const series of input.series) {
    for (const candidate of series.candidates) {
      candidates += 1;
      const award = READERS[series.form](candidate.text);
      if (!award) {
        unreadable += 1;
        issues.push(
          `${input.sourceId} ${series.id} candidate ${candidate.candidate}: no section summary found; skipped.`
        );
        continue;
      }

      /**
       * The examiner's own total is the check. Where the sections do not reach
       * it, marks are missing from the summary rather than from the candidate --
       * one 2024 candidate lists four sections against a stated 24 -- and
       * recording the shortfall would put the examiner's name to a breakdown
       * they did not give.
       */
      const summed = award.sections.reduce((total, section) => total + section.awarded, 0);
      if (summed !== award.total) {
        unbalanced += 1;
        issues.push(
          `${input.sourceId} ${series.id} candidate ${candidate.candidate}: sections total ${summed} against the examiner's ${award.total}; skipped.`
        );
        continue;
      }

      records.push({
        id: `${input.sourceId}:${series.id}:c${candidate.candidate}`,
        sourceId: input.sourceId,
        // Higher, which has no closer bucket in MarkingLevel.
        level: "alevel",
        subject: input.subject,
        // Sections carry different tariffs, which is what this regime means.
        regime: "weightedTraits",
        questionId: "assignment",
        questionPrompt: "",
        answer: { kind: "image", paths: [candidate.evidence] },
        humanMarks: [award.total],
        // Replaced below by the summed section ceilings where none was supplied.
        maxMarks: input.maxMarks ?? award.total,
        examinerCommentary: stripFurniture(candidate.text).trim(),
        criteria: award.sections.map<MarkingCriterion>((section, index) => ({
          id: `Section ${index + 1}`,
          // Not published anywhere in the payload. Filled in by the caller from
          // the highest any candidate reached, and a floor rather than a fact.
          available: 0,
          awarded: section.awarded,
          description: section.name,
        })),
      });
    }
  }

  /**
   * Each section's tariff, taken as the most any candidate scored on it.
   *
   * SQA publishes the assignment's total but not its split, so this is inferred
   * and will understate a section nobody did well on. The Pearson source infers
   * a tariff the same way and says so; the alternative is leaving `available` at
   * zero, which would make every section look impossible to earn.
   */
  const ceiling = new Map<string, number>();
  for (const record of records) {
    for (const criterion of record.criteria ?? []) {
      const key = `${record.sourceId}:${criterion.description}`;
      ceiling.set(key, Math.max(ceiling.get(key) ?? 0, criterion.awarded));
    }
  }
  let criteria = 0;
  for (const record of records) {
    for (const criterion of record.criteria ?? []) {
      criterion.available = ceiling.get(`${record.sourceId}:${criterion.description}`) ?? criterion.awarded;
      criteria += 1;
    }
  }

  /**
   * Where no tariff was supplied, the sections are all there is to sum.
   *
   * This understates whenever no candidate reached a section's ceiling -- with
   * two Psychology candidates it certainly does -- so it rises as the source
   * grows. That is the honest behaviour: a floor that improves, rather than a
   * fixed number nobody published.
   */
  if (input.maxMarks === undefined) {
    const derived = [...ceiling.values()].reduce((total, value) => total + value, 0);
    for (const record of records) record.maxMarks = derived;
  }

  return {
    records,
    issues,
    stats: { candidates, ingested: records.length, criteria, unbalanced, unreadable },
  };
}

/** Split a multi-candidate commentary into one block per candidate. */
export function splitByCandidate(pages: readonly PdfPageText[]) {
  const joined = pages.map((page) => page.text).join("\n");
  const blocks: { candidate: number; text: string }[] = [];
  const marker = /\bCandidate\s+(\d+)\b/g;
  const found: { candidate: number; at: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = marker.exec(joined)) !== null) {
    const candidate = Number(match[1]);
    // A commentary refers back to other candidates in passing; only the first
    // mention of each opens their block.
    if (!found.some((entry) => entry.candidate === candidate)) {
      found.push({ candidate, at: match.index });
    }
  }
  for (const [index, entry] of found.entries()) {
    blocks.push({
      candidate: entry.candidate,
      text: joined.slice(entry.at, found[index + 1]?.at ?? joined.length),
    });
  }
  return blocks;
}
