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

/**
 * A single mark in the scheme, and what the examiner did with it.
 *
 * This is the level Jami actually has to work at. A total says a script scored
 * four out of six; a criterion says which mark was withheld and why, which is
 * both what a student needs told and the only way to see whether Jami reached
 * the right total for the right reasons rather than by luck.
 */
export type MarkingCriterion = {
  /** The mark's identifier in the scheme, as the scheme writes it. */
  id: string;
  available: number;
  awarded: number;
  /** What the mark is for, from the mark scheme itself. */
  description?: string;
  /** The examiner's stated reason, in their words. */
  reason?: string;
  /** Credited despite an earlier error, following the candidate's own work. */
  followThrough?: boolean;
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
  /** Present where the source marks criterion by criterion. */
  criteria?: readonly MarkingCriterion[];
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
    // The public subset holds English and maths only. It was catalogued with
    // three sciences it does not contain, which made coverage look broader than
    // it is.
    subjects: ["english", "maths"],
    regimes: ["additive", "banded", "weightedTraits"],
    // Verified: the payload ships the full CC BY 4.0 licence text and the
    // README names the licence. Evidence is inside the source, not on a page
    // somewhere that has to be taken on trust.
    licence: { id: "CC BY 4.0", redistributable: true, verified: true },
    handwritten: true,
    commentary: false,
    notes:
      "The most valuable source in the corpus for its size. Ingested: 480 answers over 20 questions, half typed and half photographed handwriting, every one marked by two examiners independently. They disagree on 237 of 480, and the gap widens with the tariff — a mean of 0.05 marks on one-markers against 4.58 on the 40-mark essays, worst case 20. That curve is the bar Jami should be held to, because holding it to exact agreement would hold it to a standard the examiners themselves do not meet. Sixty answers also carry each examiner's split across assessment objectives. No written examiner commentary.",
  },
  {
    id: "qualifications-scotland",
    title: "Qualifications Scotland — Understanding Standards",
    // Higher, which is what was downloaded. It sits above National 5 and
    // alongside the first year of A-level; MarkingLevel has no closer bucket,
    // and calling it GCSE, as this entry used to, understated it by a year.
    level: "alevel",
    subjects: ["maths"],
    regimes: ["additive"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: true,
    commentary: true,
    notes:
      "The closest published thing to the criterion-by-criterion reasoning Jami must produce, and the reason it was the first board source parsed. Ingested: 89 candidate scripts from Higher maths 2023 papers 1 and 2, carrying 361 individual marks — each one identified, awarded or withheld, 107 of them with the examiner's stated reason and 38 credited on follow-through from the candidate's own earlier error. Records are marked out of what the examiner actually ruled on, which is not always the question's full tariff: 11 commentaries stop short, and counting the marks they pass over in silence as refusals would invent judgements. Scripts are scans, so an answer is a page reference, and some pages carry two candidates. Question wording and the generic scheme are not yet extracted. Only Higher maths is on disk; the programme covers far more. Measure-only: the terms permit private reading but require written permission for commercial use.",
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
    subjects: ["economics"],
    regimes: ["additive", "weightedTraits"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: true,
    commentary: true,
    notes:
      "The only source in the corpus marked by assessment objective — knowledge, application, analysis, evaluation — which is why it matters out of proportion to its size. Ingested: 42 real candidate responses to the June 2019 International A-level papers over 21 questions, each with the examiner's written rationale, averaging 900 characters. Answer-level, not criterion-level: Pearson writes paragraphs where Qualifications Scotland writes one bullet per mark, and only a handful of responses break the total into strand scores, so inferring a split from the rest would manufacture structure the examiner never wrote. Two limits: the question papers and mark schemes are page images with no text layer, so no prompt or scheme is captured, and nothing states any question's tariff — each maximum is the highest mark an exemplar actually received, a floor rather than the real total. The 2019 examiner report in the same folder is cohort feedback and marks no individual response, so it is not ingested. Only economics is on disk. Measure-only: Pearson reserves rights including text and data mining.",
  },
  {
    id: "aqa-alevel-english",
    title: "AQA A-level English exemplars",
    level: "alevel",
    subjects: ["english"],
    regimes: ["banded"],
    licence: { id: "board exemplar", redistributable: false, verified: false },
    handwritten: false,
    commentary: true,
    notes:
      "Deliberately spans bands 2 to 5, so it teaches what separates a middling essay from a top one rather than only what a good one looks like. Ingested: 4 essays, one per band, each with the examiner's overall verdict and a paragraph of commentary against all five assessment objectives. The objectives are discussed but never scored, so this is banded rather than weighted-trait. These pages award a band, not a mark out of the paper total: a record means \"placed in band N of 5\". Measure-only and likely to stay so — the pages carry AQA's copyright notice and no reuse grant.",
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
    regimes: ["banded"],
    // Verified from the Zenodo record preserved with the download, whose
    // licence metadata is cc-by-4.0 linking to the CC BY 4.0 legal code.
    licence: { id: "CC BY 4.0", redistributable: true, verified: true },
    handwritten: false,
    commentary: true,
    notes:
      "Ingested: 3,031 responses to 50 open-ended questions, each with a teacher's grade out of ten and written feedback — the largest body of marked work in the corpus and the only large source carrying the marker's reasoning. Ten empty answers were skipped. The file also holds four machine-generated grades per row (deepseek, qwen, gemini and an LLM judge); none is read, because measuring Jami against another model while calling it human agreement would make every number downstream meaningless. A Spanish twin, `dataset_es.csv`, is deliberately not ingested.",
  },
  {
    id: "mohler",
    title: "Mohler short-answer benchmark",
    level: "undergraduate",
    subjects: ["computerScience"],
    regimes: ["banded"],
    licence: { id: "research dataset", redistributable: false, verified: false },
    handwritten: false,
    commentary: false,
    notes:
      "The two-grader structure is the point: it measures how far humans are from each other, which is the bar Jami should actually be held to. Ingested: 2,273 answers over 81 questions, each graded independently by the class TA and by one of the authors. They disagree on 1,010 of them — a mean gap of 0.73 on the five-point scale and 1.63 on the ten, with 58 answers more than six marks apart. Both grades are kept; the averaged file the dataset ships is never read, because an average cannot show the spread. Assignments 11 and 12 were graded out of ten and are recorded that way rather than rescaled. Six questions the authors exclude from their own work, being selection rather than short-answer, are excluded here too. Measure-only: the Hugging Face mirror declares CC BY 4.0 but is a mirror, and the original release states no terms.",
  },
  {
    id: "graduate-neural-networks",
    title: "Graduate neural networks ASAG set",
    level: "postgraduate",
    subjects: ["computerScience", "maths"],
    // The README's own scale -- completely incorrect, partially correct,
    // perfect -- judges the whole answer rather than counting credited points.
    regimes: ["banded"],
    // The repository carries MPL 2.0, which is a software licence applied to a
    // repository that is mostly data. It permits redistribution, but whether it
    // was meant to cover the answers themselves is genuinely unclear, so this
    // stays unverified until a human decides rather than being read favourably.
    licence: { id: "MPL 2.0", redistributable: true, verified: false },
    handwritten: false,
    commentary: false,
    notes:
      "Ingested: 607 of 646 answers over 17 questions, graded 0 (completely incorrect), 1 (partially correct) or 2 (perfect). The 39 skipped are blank answers, which carry a grade but nothing to mark. One human judge, so this measures agreement and says nothing about human disagreement. Most of the file is the authors' own model output — embeddings, cosine similarities, alignment scores and stop-worded copies of the text — and none of it is ingested: it would put another system's opinion in the corpus and hand a marker under test a precomputed similarity score for the answer it is meant to be reading.",
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
