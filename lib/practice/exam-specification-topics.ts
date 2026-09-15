import { EXAM_SPECIFICATION_OUTLINES, outlineTopics } from "@/lib/practice/exam-specification-outlines";

/**
 * The topics a specification actually names, and nothing else.
 *
 * Three things were disconnected. Nothing ever wrote the canonical collection,
 * so the topic drawer was empty on every course. Extraction was never given a
 * list to map to, and kept whatever strings the model returned -- up to twenty
 * per question, unchecked -- which would have put invented topic names in front
 * of students as though they were the specification's own. And a student's
 * selection filtered on ids that therefore never matched anything.
 *
 * A catalogue is owner-controlled and versioned like the rights registry,
 * because it is the same kind of claim: something that has to be checked
 * against a published document by a person before a student sees it. A
 * catalogue drafted from memory is stored `verified: false` and is not served,
 * not seeded, and not offered to extraction. That is deliberate -- an
 * unverified topic list is worse than no topic list, because a wrong topic
 * silently narrows a student's practice to the wrong questions.
 */
export type ExamSpecificationTopic = {
  /** Stable across versions. Never renumbered: questions are stored against it. */
  id: string;
  label: string;
};

export type ExamSpecificationTopicCatalogue = {
  specificationId: string;
  /** Raised when topics are added, removed or relabelled. */
  version: number;
  /**
   * Whether a person has checked this list against the published
   * specification. Nothing unverified is seeded or served.
   */
  verified: boolean;
  /** Where the list came from, for whoever checks it next. */
  source: string;
  topics: readonly ExamSpecificationTopic[];
};

/**
 * Catalogues written out topic by topic.
 *
 * The ids are deliberately not the board's section numbers. A board can
 * renumber sections between specification versions, and these ids are stored
 * on every question extracted under them, so they are their own stable
 * identifiers and the label carries the wording.
 */
const WRITTEN_CATALOGUES: readonly ExamSpecificationTopicCatalogue[] = [
  {
    /*
     * AQA GCSE Mathematics (8300), read from the published specification.
     *
     * The grain is the finest the specification itself names. Three of its six
     * content areas have numbered subsections and three do not: 3.3, 3.5 and
     * 3.6 are flat lists of reference codes (R1-R16, P1-P9, S1-S6), so they
     * stay single topics rather than being subdivided into groupings AQA does
     * not publish. Six topics would have made the picker useless -- "Algebra"
     * is a third of the paper -- and inventing subheadings would have put
     * Jami's structure in front of a student as though it were the board's.
     *
     * Cross-checked against a real higher-tier GCSE maths paper before being
     * marked verified: all 28 questions of Edexcel 1MA1/1H June 2023 map onto
     * this list with nothing left over. Two sit on a boundary between two of
     * these topics -- a percentage increase is both Number and Ratio, a
     * counting problem is both Number and Probability -- which is a tagging
     * question and not a gap, since a question may carry more than one id.
     * Three topics that paper never exercises (sequences, vectors, measures
     * and accuracy) are in the specification and so are here.
     */
    specificationId: "8300",
    version: 1,
    verified: true,
    source:
      "AQA GCSE Mathematics (8300) published subject content, sections 3.1-3.6, " +
      "read from aqa.org.uk on 2026-09-12. Subsection headings taken from the " +
      "3.1, 3.2 and 3.4 pages; 3.3, 3.5 and 3.6 publish no subsections. " +
      "Cross-checked for coverage against Edexcel 1MA1/1H June 2023 (28 of 28 " +
      "questions map, no gaps).",
    topics: [
      { id: "aqa-8300-number-structure-and-calculation", label: "Number: structure and calculation" },
      {
        id: "aqa-8300-number-fractions-decimals-and-percentages",
        label: "Number: fractions, decimals and percentages",
      },
      { id: "aqa-8300-number-measures-and-accuracy", label: "Number: measures and accuracy" },
      {
        id: "aqa-8300-algebra-notation-vocabulary-and-manipulation",
        label: "Algebra: notation, vocabulary and manipulation",
      },
      { id: "aqa-8300-algebra-graphs", label: "Algebra: graphs" },
      {
        id: "aqa-8300-algebra-solving-equations-and-inequalities",
        label: "Algebra: solving equations and inequalities",
      },
      { id: "aqa-8300-algebra-sequences", label: "Algebra: sequences" },
      {
        id: "aqa-8300-ratio-proportion-and-rates-of-change",
        label: "Ratio, proportion and rates of change",
      },
      {
        id: "aqa-8300-geometry-properties-and-constructions",
        label: "Geometry and measures: properties and constructions",
      },
      {
        id: "aqa-8300-geometry-mensuration-and-calculation",
        label: "Geometry and measures: mensuration and calculation",
      },
      { id: "aqa-8300-geometry-vectors", label: "Geometry and measures: vectors" },
      { id: "aqa-8300-probability", label: "Probability" },
      { id: "aqa-8300-statistics", label: "Statistics" },
    ],
  },
];

const aqaMathematics = WRITTEN_CATALOGUES.find((catalogue) => catalogue.specificationId === "8300")!;

/** The same topics under another specification's own ids. */
function withIdPrefix(topics: readonly ExamSpecificationTopic[], from: string, to: string) {
  return topics.map((topic) => ({ id: topic.id.replace(from, to), label: topic.label }));
}

/**
 * The catalogues, checked and unchecked. Only a checked one is served.
 *
 * Science catalogues are derived from their specification's numbered headings
 * (see exam-specification-outlines), so a topic list and its concept list can
 * never disagree about what a section is called.
 */
export const EXAM_SPECIFICATION_TOPICS: readonly ExamSpecificationTopicCatalogue[] = [
  ...WRITTEN_CATALOGUES,
  {
    /*
     * Pearson Edexcel GCSE Mathematics (1MA1).
     *
     * Both boards teach the Department for Education's GCSE mathematics
     * subject content, and Pearson prints it under the same statement codes
     * and the same subheadings AQA does -- read from the 1MA1 specification on
     * 2026-09-15. So these are the checked 8300 topics under Pearson's own
     * ids. That they match is a reading, not a check: a person still compares
     * them with the Pearson document before they are served.
     */
    specificationId: "1MA1",
    version: 1,
    verified: false,
    source:
      "Pearson Edexcel GCSE (9-1) Mathematics (1MA1) specification, subject content read from " +
      "the published PDF on 2026-09-15: six content areas and ten subheadings identical to " +
      "AQA 8300, so the checked 8300 topics are reused under Pearson ids. Not yet checked by a person.",
    topics: withIdPrefix(aqaMathematics.topics, "aqa-8300-", "pearson-edexcel-1ma1-"),
  },
  ...EXAM_SPECIFICATION_OUTLINES.map((outline): ExamSpecificationTopicCatalogue => ({
    specificationId: outline.specificationId,
    version: 1,
    verified: outline.checked?.topics === true,
    source: outline.source,
    topics: outlineTopics(outline),
  })),
];

export function examSpecificationTopicCatalogue(specificationId: string) {
  return EXAM_SPECIFICATION_TOPICS.find(
    (catalogue) => catalogue.specificationId === specificationId
  );
}

/** Only a checked catalogue is offered to students or to extraction. */
export function servableExamSpecificationTopics(specificationId: string) {
  const catalogue = examSpecificationTopicCatalogue(specificationId);
  return catalogue?.verified ? catalogue : undefined;
}

/**
 * The topics a question may claim, separated from the ones it invented.
 *
 * Extraction keeps only ids the specification names. An id that is not in the
 * catalogue is not a near miss to be corrected -- it is the model naming a
 * topic that does not exist on this course -- so it is dropped and reported,
 * and the question keeps whatever genuine topics it also matched.
 */
export function filterCanonicalTopicIds(
  specificationId: string,
  ids: readonly string[]
): { topicIds: string[]; rejected: string[] } {
  const catalogue = servableExamSpecificationTopics(specificationId);
  if (!catalogue) return { topicIds: [], rejected: [...new Set(ids)] };
  const known = new Set(catalogue.topics.map((topic) => topic.id));
  const topicIds: string[] = [];
  const rejected: string[] = [];
  for (const id of new Set(ids)) {
    if (known.has(id)) topicIds.push(id);
    else rejected.push(id);
  }
  return { topicIds, rejected };
}
