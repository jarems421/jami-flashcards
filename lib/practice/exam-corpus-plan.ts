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

export function examCorpusTargetsForBoard(board: ExamBoardId) {
  return ENGLAND_MATHS_AND_SCIENCE.filter((target) => target.board === board);
}
