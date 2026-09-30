import {
  AQA_GCSE_BIOLOGY,
  AQA_GCSE_CHEMISTRY,
  AQA_GCSE_COMBINED_SCIENCE_TRILOGY,
  AQA_GCSE_PHYSICS,
} from "@/lib/practice/specifications/aqa-gcse-science";
import {
  AQA_GCSE_GEOGRAPHY,
  PEARSON_EDEXCEL_GCSE_BUSINESS,
  PEARSON_EDEXCEL_GCSE_FRENCH,
} from "@/lib/practice/specifications/gcse-humanities-and-languages";
import type { ExamSpecificationConcept } from "@/lib/practice/exam-specification-concepts";
import type { ExamSpecificationTopic } from "@/lib/practice/exam-specification-topics";

/**
 * Specifications whose subject content is published as numbered headings.
 *
 * AQA's science specifications name their own structure all the way down --
 * 4.1 Cell biology, 4.1.3 Transport in cells, 4.1.3.2 Osmosis -- so their topic
 * and concept catalogues are the headings themselves, written out once here
 * and derived from, rather than two hand-kept lists that can drift apart.
 *
 * The grain follows the maths catalogue. A topic is a numbered section (4.1),
 * the unit a paper and a student both name. A concept is the finest heading
 * beneath each subsection (4.1.3.2), or the subsection itself where it has no
 * headings of its own (4.2.1). Deeper numbering, such as the lettered steps
 * under "Describing motion along a line", is folded into its heading: that is
 * a sentence of the specification, not something a student practises alone.
 *
 * Headings are copied as the board titles them, with the board's markers
 * ("(biology only)", "(HT only)") taken out of the label. Higher-tier-only
 * content is kept as a flag rather than lost.
 */

export type SpecificationOutlineNode = readonly [
  reference: string,
  title: string,
  children?: readonly SpecificationOutlineNode[],
];

export type SpecificationOutline = {
  specificationId: string;
  /** Every id derived from this outline starts with it. */
  idPrefix: string;
  /**
   * A course made of several subjects labels its topics with the subject,
   * because "Atomic structure" is a chemistry section and a physics section.
   */
  groups: readonly { label?: string; sections: readonly SpecificationOutlineNode[] }[];
  /**
   * Ids are derived from titles, and ids are stored on questions. A heading the
   * board retitles keeps its id by naming its old slug here, by reference.
   */
  slugOverrides?: Readonly<Record<string, string>>;
  source: string;
  /**
   * Set by the person who checked the derived lists against the published
   * specification. Topics first: concepts are only ever served beneath a
   * checked topic list.
   */
  checked?: { topics: boolean; concepts: boolean };
};

const MARKERS = /\s*\((?:(?:biology|chemistry|physics) only|HT only|common content with (?:biology|chemistry|physics))\)/gi;

/** A heading as a student reads it: the board's markers removed. */
export function outlineLabel(title: string) {
  return title.replace(MARKERS, "").replace(/\s+/g, " ").trim();
}

function higherTierOnly(title: string) {
  return /\(HT only\)/i.test(title);
}

export function outlineSlug(label: string) {
  return label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\p{Quotation_Mark}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugOf(outline: SpecificationOutline, [reference, title]: SpecificationOutlineNode) {
  return outline.slugOverrides?.[reference] ?? outlineSlug(outlineLabel(title));
}

function sectionsOf(outline: SpecificationOutline) {
  return outline.groups.flatMap((group) =>
    group.sections.map((section) => ({ group, section, id: `${outline.idPrefix}-${slugOf(outline, section)}` }))
  );
}

export function outlineTopics(outline: SpecificationOutline): ExamSpecificationTopic[] {
  return sectionsOf(outline).map(({ group, section, id }) => ({
    id,
    label: group.label ? `${group.label}: ${outlineLabel(section[1])}` : outlineLabel(section[1]),
    ...(group.label ? { group: group.label } : {}),
  }));
}

export function outlineConcepts(outline: SpecificationOutline): ExamSpecificationConcept[] {
  return sectionsOf(outline).flatMap(({ section, id: topicId }) =>
    (section[2] ?? []).flatMap((subsection) => {
      const [, subsectionTitle, headings] = subsection;
      const leaves = headings?.length ? headings : [subsection];
      return leaves.map((leaf) => {
        const [reference, title] = leaf;
        const higher = higherTierOnly(section[1]) || higherTierOnly(subsectionTitle) || higherTierOnly(title);
        return {
          id: `${topicId}-${slugOf(outline, leaf)}`,
          parentTopicId: topicId,
          label: outlineLabel(title),
          // Omitted rather than empty: Pearson numbers neither French's themes
          // nor its topics, and a blank reference is not a reference.
          ...(reference ? { reference } : {}),
          ...(higher ? { higherTierOnly: true } : {}),
        };
      });
    })
  );
}

export {
  AQA_GCSE_BIOLOGY,
  AQA_GCSE_CHEMISTRY,
  AQA_GCSE_COMBINED_SCIENCE_TRILOGY,
  AQA_GCSE_PHYSICS,
} from "@/lib/practice/specifications/aqa-gcse-science";
export {
  AQA_GCSE_GEOGRAPHY,
  PEARSON_EDEXCEL_GCSE_BUSINESS,
  PEARSON_EDEXCEL_GCSE_FRENCH,
} from "@/lib/practice/specifications/gcse-humanities-and-languages";

export const EXAM_SPECIFICATION_OUTLINES: readonly SpecificationOutline[] = [
  AQA_GCSE_BIOLOGY,
  AQA_GCSE_CHEMISTRY,
  AQA_GCSE_PHYSICS,
  AQA_GCSE_COMBINED_SCIENCE_TRILOGY,
  AQA_GCSE_GEOGRAPHY,
  PEARSON_EDEXCEL_GCSE_BUSINESS,
  PEARSON_EDEXCEL_GCSE_FRENCH,
];
