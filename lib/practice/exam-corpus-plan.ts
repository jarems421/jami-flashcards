import type { ExamBoardId } from "@/lib/practice/exam-formats";

/**
 * The corpus rollout, in the order it is actually being built.
 *
 * England's three big boards and the quantitative subjects first, because
 * those are where a mark scheme is most nearly objective: a maths or science
 * scheme awards on specific values, terms and steps, so an extraction can be
 * checked against the page with much less ambiguity than an essay band
 * descriptor. Getting the loop right on those before touching banded marking
 * is deliberate, not an accident of ordering.
 *
 * The codes here are the boards' own specification codes and are what the
 * discovery step matches links against. They go stale when a board reissues a
 * specification, which is why nothing reads them as truth -- the catalogue
 * decides what is current, and this only decides what to look for first.
 */
export type ExamCorpusTarget = {
  board: ExamBoardId;
  subject: string;
  level: "gcse" | "a_level";
  specificationId: string;
  specificationTitle: string;
  /** The written components, as the board codes them. */
  components: Array<{ code: string; title: string; tier?: string }>;
};

export const ENGLAND_MATHS_AND_SCIENCE: readonly ExamCorpusTarget[] = [
  {
    board: "aqa",
    subject: "Mathematics",
    level: "gcse",
    specificationId: "8300",
    specificationTitle: "GCSE Mathematics",
    components: [
      { code: "1F", title: "Paper 1 Foundation", tier: "Foundation" },
      { code: "1H", title: "Paper 1 Higher", tier: "Higher" },
      { code: "2F", title: "Paper 2 Foundation", tier: "Foundation" },
      { code: "2H", title: "Paper 2 Higher", tier: "Higher" },
      { code: "3F", title: "Paper 3 Foundation", tier: "Foundation" },
      { code: "3H", title: "Paper 3 Higher", tier: "Higher" },
    ],
  },
  {
    board: "aqa",
    subject: "Biology",
    level: "gcse",
    specificationId: "8461",
    specificationTitle: "GCSE Biology",
    components: [
      { code: "1F", title: "Paper 1 Foundation", tier: "Foundation" },
      { code: "1H", title: "Paper 1 Higher", tier: "Higher" },
      { code: "2F", title: "Paper 2 Foundation", tier: "Foundation" },
      { code: "2H", title: "Paper 2 Higher", tier: "Higher" },
    ],
  },
  {
    board: "aqa",
    subject: "Chemistry",
    level: "gcse",
    specificationId: "8462",
    specificationTitle: "GCSE Chemistry",
    components: [
      { code: "1F", title: "Paper 1 Foundation", tier: "Foundation" },
      { code: "1H", title: "Paper 1 Higher", tier: "Higher" },
      { code: "2F", title: "Paper 2 Foundation", tier: "Foundation" },
      { code: "2H", title: "Paper 2 Higher", tier: "Higher" },
    ],
  },
  {
    board: "aqa",
    subject: "Physics",
    level: "gcse",
    specificationId: "8463",
    specificationTitle: "GCSE Physics",
    components: [
      { code: "1F", title: "Paper 1 Foundation", tier: "Foundation" },
      { code: "1H", title: "Paper 1 Higher", tier: "Higher" },
      { code: "2F", title: "Paper 2 Foundation", tier: "Foundation" },
      { code: "2H", title: "Paper 2 Higher", tier: "Higher" },
    ],
  },
  /*
   * Combined Science is its own course, not the three sciences at once: a
   * student sits six shorter papers, a Biology, Chemistry and Physics Paper 1
   * and 2, each at Foundation or Higher. Coded as AQA prints them on the cover
   * -- 8464/B/1H -- which is also what its file names are built from.
   */
  {
    board: "aqa",
    subject: "Combined Science: Trilogy",
    level: "gcse",
    specificationId: "8464",
    specificationTitle: "GCSE Combined Science: Trilogy",
    components: (["Biology", "Chemistry", "Physics"] as const).flatMap((science) =>
      ([1, 2] as const).flatMap((paper) =>
        (["Foundation", "Higher"] as const).map((tier) => ({
          code: `${science[0]}/${paper}${tier[0]}`,
          title: `${science} Paper ${paper} ${tier}`,
          tier,
        }))
      )
    ),
  },
  {
    board: "aqa",
    subject: "Mathematics",
    level: "a_level",
    specificationId: "7357",
    specificationTitle: "A-level Mathematics",
    components: [
      { code: "1", title: "Paper 1" },
      { code: "2", title: "Paper 2" },
      { code: "3", title: "Paper 3" },
    ],
  },
  {
    board: "aqa",
    subject: "Biology",
    level: "a_level",
    specificationId: "7402",
    specificationTitle: "A-level Biology",
    components: [
      { code: "1", title: "Paper 1" },
      { code: "2", title: "Paper 2" },
      { code: "3", title: "Paper 3" },
    ],
  },
  {
    board: "aqa",
    subject: "Chemistry",
    level: "a_level",
    specificationId: "7405",
    specificationTitle: "A-level Chemistry",
    components: [
      { code: "1", title: "Paper 1" },
      { code: "2", title: "Paper 2" },
      { code: "3", title: "Paper 3" },
    ],
  },
  {
    board: "aqa",
    subject: "Physics",
    level: "a_level",
    specificationId: "7408",
    specificationTitle: "A-level Physics",
    components: [
      { code: "1", title: "Paper 1" },
      { code: "2", title: "Paper 2" },
      { code: "3", title: "Paper 3" },
    ],
  },
  {
    board: "pearson_edexcel",
    subject: "Mathematics",
    level: "gcse",
    specificationId: "1MA1",
    specificationTitle: "Pearson Edexcel GCSE Mathematics",
    components: [
      { code: "1MA1/1F", title: "Paper 1 Foundation", tier: "Foundation" },
      { code: "1MA1/1H", title: "Paper 1 Higher", tier: "Higher" },
      { code: "1MA1/2F", title: "Paper 2 Foundation", tier: "Foundation" },
      { code: "1MA1/2H", title: "Paper 2 Higher", tier: "Higher" },
      { code: "1MA1/3F", title: "Paper 3 Foundation", tier: "Foundation" },
      { code: "1MA1/3H", title: "Paper 3 Higher", tier: "Higher" },
    ],
  },
];

/**
 * The humanities and languages, added after the quantitative courses.
 *
 * These are where marking stops being nearly objective: their schemes are
 * banded, so a mark is a judgement about a whole response rather than a sum of
 * awarded points. Nothing here asserts the marker handles that well -- the
 * marking-quality registry has no measurement for banded answers -- so what
 * ingestion produces on these courses is material for review, not a claim that
 * essays can be marked.
 *
 * Every written component the board offers is listed, including ones whose
 * question paper the board does not publish: the plan says what a course is
 * made of, and discovery reports what it cannot find rather than the plan
 * quietly pretending the paper does not exist. Checked against the boards'
 * own filestores on 2026-09-16: AQA publishes the mark scheme but not the
 * question paper for English Language Paper 1 in every series looked at, and
 * for Geography Papers 1 and 2 in June 2023.
 */
export const ENGLAND_HUMANITIES_AND_LANGUAGES: readonly ExamCorpusTarget[] = [
  {
    board: "aqa",
    subject: "Geography",
    level: "gcse",
    specificationId: "8035",
    specificationTitle: "GCSE Geography",
    components: [
      { code: "1", title: "Paper 1 Living with the physical environment" },
      { code: "2", title: "Paper 2 Challenges in the human environment" },
      { code: "3", title: "Paper 3 Geographical applications" },
    ],
  },
  {
    board: "aqa",
    subject: "English Language",
    level: "gcse",
    specificationId: "8700",
    specificationTitle: "GCSE English Language",
    components: [
      { code: "1", title: "Paper 1 Explorations in creative reading and writing" },
      { code: "2", title: "Paper 2 Writers' viewpoints and perspectives" },
    ],
  },
  {
    board: "aqa",
    subject: "English Literature",
    level: "gcse",
    specificationId: "8702",
    specificationTitle: "GCSE English Literature",
    components: [
      { code: "1", title: "Paper 1 Shakespeare and the 19th-century novel" },
      { code: "2", title: "Paper 2 Modern texts and poetry" },
    ],
  },
  {
    board: "pearson_edexcel",
    subject: "Business",
    level: "gcse",
    specificationId: "1BS0",
    specificationTitle: "Pearson Edexcel GCSE Business",
    components: [
      { code: "1BS0/01", title: "Paper 1 Investigating small business" },
      { code: "1BS0/02", title: "Paper 2 Building a business" },
    ],
  },
  {
    /*
     * Reading and writing only. Paper 2 is the speaking test, which has no
     * question paper to ingest, and Paper 1 is listening, which is unanswerable
     * without audio Jami neither stores nor serves. Listing them would mean
     * discovery hunting every series for files that cannot be practised.
     */
    board: "pearson_edexcel",
    subject: "French",
    level: "gcse",
    specificationId: "1FR0",
    specificationTitle: "Pearson Edexcel GCSE French",
    components: [
      { code: "1FR0/3F", title: "Paper 3 Reading and understanding Foundation", tier: "Foundation" },
      { code: "1FR0/3H", title: "Paper 3 Reading and understanding Higher", tier: "Higher" },
      { code: "1FR0/4F", title: "Paper 4 Writing Foundation", tier: "Foundation" },
      { code: "1FR0/4H", title: "Paper 4 Writing Higher", tier: "Higher" },
    ],
  },
];

/** Every course in the rollout, whatever the subject. */
export const EXAM_CORPUS_TARGETS: readonly ExamCorpusTarget[] = [
  ...ENGLAND_MATHS_AND_SCIENCE,
  ...ENGLAND_HUMANITIES_AND_LANGUAGES,
];

export function examCorpusTargetsForBoard(board: ExamBoardId) {
  return EXAM_CORPUS_TARGETS.filter((target) => target.board === board);
}
