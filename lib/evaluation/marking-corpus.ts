/**
 * The evaluation corpus: real student work carrying real human marks.
 *
 * Two jobs, deliberately kept apart. Measurement asks whether Jami's marks
 * match a human's, and wants breadth — every subject, every level, every
 * marking regime. Exemplars go inside a marking prompt to show the model what
 * marked work looks like, and want only a handful of the very best.
 *
 * The cost of those two jobs is completely different, and this is the thing to
 * hold onto when sizing the corpus: ingesting a hundred thousand responses is
 * free, because it is local disk. Only *running Jami against a response* costs
 * money. So the corpus should be as broad as it can be, and the evaluation run
 * over it should be a stratified sample. See `planEvaluation`.
 */

export type MarkingLevel =
  | "gcse"
  | "alevel"
  | "advancedHigher"
  | "undergraduate"
  | "postgraduate";

export type MarkingRegime =
  | "additive"
  | "pointPool"
  | "banded"
  | "weightedTraits"
  | "competency";

export type CorpusLicence = {
  /** Short identifier, e.g. "CC BY 4.0" or "board exemplar". */
  id: string;
  /**
   * Whether the terms permit this material inside a prompt the product sends.
   * Open licences do; exam board exemplars are free to read but not to
   * redistribute, so they stay on the measurement side of the line.
   */
  redistributable: boolean;
  /**
   * Whether a human has actually confirmed the terms. Unverified material is
   * never treated as shippable however permissive it looks — the same
   * fail-closed rule the provider gates use.
   */
  verified: boolean;
};

export type MarkingCorpusSource = {
  id: string;
  title: string;
  level: MarkingLevel;
  subjects: readonly string[];
  regimes: readonly MarkingRegime[];
  licence: CorpusLicence;
  /** Whether the answers are handwritten images rather than typed text. */
  handwritten: boolean;
  /** Whether the source carries examiner commentary explaining the marks. */
  commentary: boolean;
  notes: string;
};

export type MarkingCorpusRecord = {
  id: string;
  sourceId: string;
  level: MarkingLevel;
  subject: string;
  regime: MarkingRegime;
  questionId: string;
  questionPrompt: string;
  answer:
    | { kind: "text"; text: string }
    | { kind: "image"; paths: readonly string[] };
  /** One entry per human marker. More than one makes disagreement measurable. */
  humanMarks: readonly number[];
  maxMarks: number;
  markScheme?: string;
  examinerCommentary?: string;
};

/**
 * Material may only be used as an exemplar when a human has confirmed the
 * licence allows redistribution. Everything else is measurement-only.
 */
export function isShippableAsExemplar(source: MarkingCorpusSource) {
  return source.licence.verified && source.licence.redistributable;
}

export function referenceMark(record: MarkingCorpusRecord) {
  if (record.humanMarks.length === 0) return 0;
  const total = record.humanMarks.reduce((sum, mark) => sum + mark, 0);
  return total / record.humanMarks.length;
}

/**
 * The spread between human markers on the same answer.
 *
 * This is the number that says what "good" even means. Where two examiners
 * disagree by two marks, Jami landing within two of them is at human parity,
 * and holding it to exact agreement would be holding it to a standard the
 * humans did not meet either.
 */
export function humanDisagreement(record: MarkingCorpusRecord) {
  if (record.humanMarks.length < 2) return null;
  return Math.max(...record.humanMarks) - Math.min(...record.humanMarks);
}

/**
 * The catalogue. Breadth here costs nothing; it is the evaluation run that
 * costs, and that is sampled from whatever has actually been ingested.
 *
 * `verified: false` on every entry is deliberate — nobody has read the terms
 * yet, so nothing is shippable as an exemplar until someone does. Flip a
 * licence to verified only after actually reading it.
 */
export const MARKING_CORPUS_SOURCES: readonly MarkingCorpusSource[] = [
  {
    id: "medly-gcse",
    title: "Medly GCSE marking benchmark (public subset)",
    level: "gcse",
    subjects: ["maths", "english", "biology", "chemistry", "physics"],
    regimes: ["additive", "pointPool", "banded"],
    licence: { id: "CC BY 4.0", redistributable: true, verified: false },
    handwritten: true,
    commentary: false,
    notes:
      "Double-marked real responses with examiner marks. The public subset is small, so treat it as exemplars and human-disagreement calibration rather than a large test set.",
  },
  {
    id: "qualifications-scotland",
    title: "Qualifications Scotland — Understanding Standards",
    level: "gcse",
    subjects: ["maths", "english", "biology", "chemistry", "physics", "history"],
    regimes: ["additive", "pointPool", "banded"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: true,
    commentary: true,
    notes:
      "Candidate scripts with marking instructions and commentary naming each mark and why it was withheld. The closest published thing to the criterion-by-criterion reasoning Jami must produce.",
  },
  {
    id: "qualifications-scotland-advanced-higher",
    title: "Qualifications Scotland — Advanced Higher",
    level: "advancedHigher",
    subjects: ["maths", "physics", "chemistry"],
    regimes: ["additive"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: true,
    commentary: true,
    notes:
      "Upper-school maths at close to first-year undergraduate difficulty. The best available proxy for proof-style marking, which no corpus covers properly.",
  },
  {
    id: "nzqa-exemplars",
    title: "NZQA annotated exemplars",
    level: "gcse",
    subjects: ["maths", "biology", "chemistry", "physics", "english", "economics"],
    regimes: ["pointPool", "banded", "competency"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: false,
    commentary: true,
    notes: "Broad subject coverage with assessor commentary; strong for building a retrieval bank.",
  },
  {
    id: "pearson-gcse",
    title: "Pearson GCSE exemplars",
    level: "gcse",
    subjects: ["maths", "english", "biology", "chemistry", "physics"],
    regimes: ["additive", "pointPool", "banded"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: true,
    commentary: true,
    notes: "Method marks, accuracy marks, dependencies and common mistakes, stated in the boards' own notation.",
  },
  {
    id: "ocr-gcse",
    title: "OCR GCSE exemplars",
    level: "gcse",
    subjects: ["maths", "english", "biology", "chemistry", "physics"],
    regimes: ["additive", "pointPool", "banded"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: true,
    commentary: true,
    notes: "Second board for the same regimes; useful for checking Jami is not overfitting to one house style.",
  },
  {
    id: "pearson-alevel",
    title: "Pearson Edexcel A-level exemplars",
    level: "alevel",
    subjects: ["economics", "maths", "business", "biology", "chemistry", "physics"],
    regimes: ["additive", "banded", "weightedTraits"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: true,
    commentary: true,
    notes: "Student answers with examiner comments, marks and common errors. Economics is the best available AO-style calibration.",
  },
  {
    id: "aqa-alevel-english",
    title: "AQA A-level English exemplars",
    level: "alevel",
    subjects: ["english"],
    regimes: ["banded", "weightedTraits"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: false,
    commentary: true,
    notes: "Deliberately spans bands 2 to 5, so it teaches what separates a middling essay from a top one rather than only what a good one looks like.",
  },
  {
    id: "ocr-alevel",
    title: "OCR A-level candidate work",
    level: "alevel",
    subjects: ["english", "history"],
    regimes: ["banded"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: false,
    commentary: true,
    notes: "Extended-response calibration.",
  },
  {
    id: "cambridge-international-alevel",
    title: "Cambridge International A-level example candidate responses",
    level: "alevel",
    subjects: ["maths", "biology", "chemistry", "physics", "economics", "english"],
    regimes: ["additive", "pointPool", "banded"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: true,
    commentary: true,
    notes: "High, middle and low responses per question. Some material sits behind school-only access.",
  },
  {
    id: "handwritten-university-data-science",
    title: "Handwritten university exam dataset (data science)",
    level: "undergraduate",
    subjects: ["dataScience", "statistics", "maths"],
    // Two marks awarded in halves against a short list of expected points, which
    // is what the parser records. It was catalogued as additive at first, and
    // that was simply wrong: there are no method marks here to depend on.
    regimes: ["pointPool"],
    licence: { id: "CC BY 4.0", redistributable: true, verified: false },
    handwritten: true,
    commentary: true,
    notes:
      "Raw handwriting, teacher-annotated version, answer key and per-question human marks. The closest published match to Jami's own pipeline. Ingested: 544 short-answer records from 50 students. Licence stays unverified — the payload ships no licence file and its README names no terms, so the CC BY claim rests on the repository page rather than on anything in the source. Do not read `Student_MCQ.csv` or `file.txt`: both still carry real student names and institutional ID numbers despite the README stating that all identifiers were anonymised. The scripts also arrived bundled into eleven transport packs; those are read only to check they reproduce the published per-student PDFs page for page, and their grouping is not part of the source.",
  },
  {
    id: "engsaf",
    title: "EngSAF short-answer engineering corpus",
    level: "undergraduate",
    subjects: ["engineering", "physics", "computerScience"],
    regimes: ["pointPool", "additive"],
    licence: { id: "research dataset", redistributable: false, verified: false },
    handwritten: false,
    commentary: false,
    notes:
      "Around 5,800 answers over 119 questions and 25 courses with instructor references. Its generated-feedback component must be kept apart from the human marks.",
  },
  {
    id: "jorgpt",
    title: "JorGPT open-ended computer science responses",
    level: "undergraduate",
    subjects: ["computerScience"],
    regimes: ["banded", "pointPool"],
    licence: { id: "research dataset", redistributable: false, verified: false },
    handwritten: false,
    commentary: false,
    notes: "About 3,000 authentic responses to 50 open-ended questions.",
  },
  {
    id: "mohler",
    title: "Mohler short-answer benchmark",
    level: "undergraduate",
    subjects: ["computerScience"],
    regimes: ["pointPool"],
    licence: { id: "research dataset", redistributable: false, verified: false },
    handwritten: false,
    commentary: false,
    notes:
      "Roughly 2,300 answers scored 0–5 by two graders each. The two-grader structure is the point: it measures how far humans are from each other, which is the bar Jami should actually be held to.",
  },
  {
    id: "graduate-neural-networks",
    title: "Graduate neural networks ASAG set",
    level: "postgraduate",
    subjects: ["computerScience", "maths"],
    regimes: ["pointPool"],
    licence: { id: "research dataset", redistributable: false, verified: false },
    handwritten: false,
    commentary: false,
    notes: "646 answers graded incorrect / partially correct / correct at postgraduate level.",
  },
  {
    id: "university-model-solutions",
    title: "University past papers with model solutions",
    level: "undergraduate",
    subjects: ["maths", "physics", "engineering"],
    regimes: ["additive", "weightedTraits"],
    licence: { id: "institutional", redistributable: false, verified: false },
    handwritten: false,
    commentary: false,
    notes:
      "Questions and official solutions rather than marked student work, so it informs what a correct solution contains, not what a human awarded. Proof-style marking still has no proper corpus and needs a hand-marked regression set.",
  },
];

export function corpusSource(sourceId: string) {
  return MARKING_CORPUS_SOURCES.find((source) => source.id === sourceId);
}

/** Every subject named anywhere in the catalogue, deduplicated and sorted. */
export function corpusSubjects() {
  return [
    ...new Set(MARKING_CORPUS_SOURCES.flatMap((source) => source.subjects)),
  ].sort();
}

/** Which levels and regimes have no source at all, so gaps are visible. */
export function corpusCoverageGaps() {
  const levels: MarkingLevel[] = [
    "gcse",
    "alevel",
    "advancedHigher",
    "undergraduate",
    "postgraduate",
  ];
  const regimes: MarkingRegime[] = [
    "additive",
    "pointPool",
    "banded",
    "weightedTraits",
    "competency",
  ];
  const gaps: { level: MarkingLevel; regime: MarkingRegime }[] = [];
  for (const level of levels) {
    for (const regime of regimes) {
      const covered = MARKING_CORPUS_SOURCES.some(
        (source) => source.level === level && source.regimes.includes(regime)
      );
      if (!covered) gaps.push({ level, regime });
    }
  }
  return gaps;
}
