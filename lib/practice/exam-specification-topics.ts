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
 * Drafts, pending a check against each board's published specification.
 *
 * The ids are deliberately not the board's section numbers. A board can
 * renumber sections between specification versions, and these ids are stored
 * on every question extracted under them, so they are their own stable
 * identifiers and the label carries the wording.
 */
export const EXAM_SPECIFICATION_TOPICS: readonly ExamSpecificationTopicCatalogue[] = [
  {
    specificationId: "8461",
    version: 1,
    verified: false,
    source:
      "Drafted from the published AQA GCSE Biology (8461) subject content headings. " +
      "Must be checked against the specification document before it is seeded.",
    topics: [
      { id: "aqa-8461-cell-biology", label: "Cell biology" },
      { id: "aqa-8461-organisation", label: "Organisation" },
      { id: "aqa-8461-infection-and-response", label: "Infection and response" },
      { id: "aqa-8461-bioenergetics", label: "Bioenergetics" },
      { id: "aqa-8461-homeostasis-and-response", label: "Homeostasis and response" },
      {
        id: "aqa-8461-inheritance-variation-evolution",
        label: "Inheritance, variation and evolution",
      },
      { id: "aqa-8461-ecology", label: "Ecology" },
    ],
  },
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
