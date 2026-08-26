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

/**
 * What the candidate set out to do, which is the closest thing an open
 * coursework task has to a question.
 *
 * Recorded because leaving it out would repeat the mistake this corpus exists
 * to have caught: the Qualifications Scotland records carried no question and
 * no scheme, and supplying them was worth twenty points of criterion
 * agreement. An assignment has no printed question, but it does have the title
 * or topic the candidate chose, and the commentary states it.
 */
export function readAssignmentTitle(text: string) {
  const clean = stripFurniture(text);
  const lower = clean.toLowerCase();
  const at = ["title:", "topic:"]
    .map((marker) => lower.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (at === undefined) return "";
  const after = clean.slice(at + "title:".length, at + "title:".length + 160);

  // Cut at whatever starts the commentary proper. A lookahead did this badly:
  // the title runs straight into the prose with no full stop, so the shortest
  // match that satisfied the lookahead was already longer than the title.
  const stops = [
    ". ",
    " The candidate",
    " Candidate ",
    " Section ",
    " Introduction",
    " In lines",
    " In line ",
    " Framing the issue",
  ];
  const cut = stops
    .map((stop) => after.indexOf(stop))
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];
  // A title is a sentence at most. Where none of the stops appear, length is the
  // backstop, because half a paragraph in the prompt is worse than a short title.
  return (cut === undefined ? after.slice(0, 90) : after.slice(0, cut)).trim();
}

/**
 * The published marking grid, which the corpus was withholding from the marker.
 *
 * Every record here carried its section names and their tariffs and nothing
 * else, so a marker was asked to place a mark on a ten-point scale with no
 * statement of what any point on it meant. It did the only sensible thing and
 * hedged: over five assignments the examiners used the whole 0 to 10 range on
 * "analysing and synthesising" while Jami never left 4 to 7, and that section
 * alone accounted for 4.2 of a 5.0 mark error on a 30-mark paper. The other
 * four sections, whose criteria are far more concrete, sat between 0.2 and 1.4.
 *
 * This is the same fault the Qualifications Scotland records had before the
 * question and mark scheme were supplied, which was worth twenty points of
 * criterion agreement. A benchmark that hides the rubric measures the corpus,
 * not the marker -- production sends the whole scheme, so it was never running
 * this blind.
 *
 * Taken verbatim from the SQA assignment assessment task, whose own terms allow
 * reproduction in support of SQA qualifications on a non-commercial basis. It
 * stays on the measurement side of the line like the rest of this source, and
 * must not be shown to a student.
 *
 * https://www.sqa.org.uk/files_ccc/HigherCATModernStudies.pdf
 */
export const MODERN_STUDIES_ASSIGNMENT_SCHEME = [
  "Higher Modern Studies assignment, 30 marks. Award positively: marks accumulate for skills, knowledge and understanding demonstrated, and are never deducted for errors or omissions.",
  "",
  "A Identifying and demonstrating knowledge and understanding of the issue (10 marks). Up to 5 marks for background and framing of the issue and its alternatives; a further 5 for knowledge and understanding used to support the analysis. 0: no appropriate issue identified. 1: issue identified and background explained. 2: significance explained in terms of at least one aspect (political, social, economic, legal, international). 3: significance explained in terms of more than one aspect. 4: alternative decisions framed as a specific course of action against one or more alternatives. 5: detailed explanation of the alternative courses of action. For the second five, award up to 5 depending on quality of background information, level of detail, range of information supporting different aspects of the analysis, and synthesis of background with research evidence.",
  "",
  "B Analysing and synthesising information from a range of sources (10 marks). Award a maximum of 5 marks in total if no reference is made to research evidence. On implications: 0: implications not considered. 1: implications of one decision or course of action considered in terms of one aspect. 2: a single course of action in terms of two aspects, or two possible decisions in terms of one aspect. 3: a single course of action in terms of more than two aspects, or several possible decisions in terms of one aspect. 4: at least two possible decisions in terms of at least two aspects. 5: several possible decisions in terms of multiple aspects. On research evidence: 0: no reference. 1: one relevant reference. 2: two relevant references. 3: three relevant references. 4: evidence linked to support the analysis. 5: detailed evidence synthesised to support the analysis.",
  "",
  "C Evaluating the usefulness and reliability of sources (2 marks). 0: no evaluation. 1: clear evaluation of at least one source, or a generalised statement of usefulness or reliability. 2: clear evaluation making a comparative judgement of at least two sources.",
  "",
  "D Communicating information using the conventions of a report (4 marks). 0: no report format or coherent structure. Award up to 4 based on structure and use of headings, report style and social science terminology, reference to evidence used, and consistency, coherence and logic of argument.",
  "",
  "E Reaching a decision supported by evidence (4 marks). 0: no evidence presented to support the decision. 1: decision supported by evidence. 2: decision supported by detailed evidence. 3: decision supported by evidence as to why it is preferred to the alternatives. 4: decision supported by detailed evidence and evaluation as to why it is preferred to the alternatives.",
  "",
  "Do not award marks for information simply copied from the research sheet and not used to demonstrate skills, knowledge or understanding. The research sheet itself is not marked.",
].join(String.fromCharCode(10));

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
  /** The board's published grid, so the marker is not guessing at the scale. */
  markScheme?: string;
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
        questionPrompt: readAssignmentTitle(candidate.text),
        ...(input.markScheme ? { markScheme: input.markScheme } : {}),
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
