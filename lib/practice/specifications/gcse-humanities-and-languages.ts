/**
 * The non-science GCSE catalogues: AQA Geography, Edexcel Business and French.
 *
 * These specifications publish a shallower structure than the sciences -- named
 * units rather than four levels of numbered heading -- so their outlines are
 * correspondingly shorter. See `exam-specification-outlines.ts` for the shape.
 */

import type { SpecificationOutline } from "@/lib/practice/exam-specification-outlines";

export const AQA_GCSE_GEOGRAPHY: SpecificationOutline = {
  specificationId: "8035",
  idPrefix: "aqa-8035",
  source:
    "AQA GCSE Geography (8035) sections 3.1-3.3, read from the subject content pages on " +
    "aqa.org.uk on 2026-09-16. Sections 3.2.1 and 3.2.2 publish key ideas rather than " +
    "numbered headings and so carry no concepts. Not yet checked by a person.",
  groups: [{
    sections: [
      ["3.1.1", "The challenge of natural hazards", [
        ["3.1.1.1", "Natural hazards"],
        ["3.1.1.2", "Tectonic hazards"],
        ["3.1.1.3", "Weather hazards"],
        ["3.1.1.4", "Climate change"],
      ]],
      ["3.1.2", "The living world", [
        ["3.1.2.1", "Ecosystems"],
        ["3.1.2.2", "Tropical rainforests"],
        ["3.1.2.3", "Hot deserts"],
        ["3.1.2.4", "Cold environments"],
      ]],
      ["3.1.3", "Physical landscapes in the UK", [
        ["3.1.3.1", "UK physical landscapes"],
        ["3.1.3.2", "Coastal landscapes in the UK"],
        ["3.1.3.3", "River landscapes in the UK"],
        ["3.1.3.4", "Glacial landscapes in the UK"],
      ]],
      ["3.2.1", "Urban issues and challenges"],
      ["3.2.2", "The changing economic world"],
      ["3.2.3", "The challenge of resource management", [
        ["3.2.3.1", "Resource management"],
        ["3.2.3.2", "Food"],
        ["3.2.3.3", "Water"],
        ["3.2.3.4", "Energy"],
      ]],
      ["3.3.1", "Issue evaluation"],
      ["3.3.2", "Fieldwork"],
    ],
  }],
};

/**
 * Pearson Edexcel GCSE Business (1BS0).
 *
 * The specification numbers itself all the way down -- Topic 1.2 Spotting a
 * business opportunity, 1.2.3 Market segmentation -- so a topic is a numbered
 * topic and a concept is the subtopic beneath it, exactly as the sciences are
 * read. The two themes are the two papers, and are not topics: a student
 * revising says "market segmentation", not "Theme 1".
 */
export const PEARSON_EDEXCEL_GCSE_BUSINESS: SpecificationOutline = {
  specificationId: "1BS0",
  idPrefix: "pearson-edexcel-1bs0",
  source:
    "Pearson Edexcel GCSE (9-1) Business (1BS0) specification, subject content read from the " +
    "published PDF on 2026-09-16: ten numbered topics and the subtopics printed beneath them. " +
    "Not yet checked by a person.",
  groups: [{
    sections: [
      ["1.1", "Enterprise and entrepreneurship", [
        ["1.1.1", "The dynamic nature of business"],
        ["1.1.2", "Risk and reward"],
        ["1.1.3", "The role of business enterprise and entrepreneurship"],
      ]],
      ["1.2", "Spotting a business opportunity", [
        ["1.2.1", "Customer needs"],
        ["1.2.2", "Market research"],
        ["1.2.3", "Market segmentation"],
        ["1.2.4", "The competitive environment"],
      ]],
      ["1.3", "Putting a business idea into practice", [
        ["1.3.1", "Business aims and objectives"],
        ["1.3.2", "Business revenues, costs and profits"],
        ["1.3.3", "Cash and cash-flow"],
        ["1.3.4", "Sources of business finance"],
      ]],
      ["1.4", "Making the business effective", [
        ["1.4.1", "The options for start-up and small businesses"],
        ["1.4.2", "Business location"],
        ["1.4.3", "The marketing mix"],
        ["1.4.4", "Business plans"],
      ]],
      ["1.5", "Understanding external influences on business", [
        ["1.5.1", "Business stakeholders"],
        ["1.5.2", "Technology and business"],
        ["1.5.3", "Legislation and business"],
        ["1.5.4", "The economy and business"],
        ["1.5.5", "External influences"],
      ]],
      ["2.1", "Growing the business", [
        ["2.1.1", "Business growth"],
        ["2.1.2", "Changes in business aims and objectives"],
        ["2.1.3", "Business and globalisation"],
        ["2.1.4", "Ethics, the environment and business"],
      ]],
      ["2.2", "Making marketing decisions", [
        ["2.2.1", "Product"],
        ["2.2.2", "Price"],
        ["2.2.3", "Promotion"],
        ["2.2.4", "Place"],
        ["2.2.5", "Using the marketing mix to make business decisions"],
      ]],
      ["2.3", "Making operational decisions", [
        ["2.3.1", "Business operations"],
        ["2.3.2", "Working with suppliers"],
        ["2.3.3", "Managing quality"],
        ["2.3.4", "The sales process"],
      ]],
      ["2.4", "Making financial decisions", [
        ["2.4.1", "Business calculations"],
        ["2.4.2", "Understanding business performance"],
      ]],
      ["2.5", "Making human resource decisions", [
        ["2.5.1", "Organisational structures"],
        ["2.5.2", "Effective recruitment"],
        ["2.5.3", "Effective training and development"],
        ["2.5.4", "Motivation"],
      ]],
    ],
  }],
};

/**
 * Pearson Edexcel GCSE French (1FR0).
 *
 * A language specification has no subject content to divide into topics the
 * way a science does: every paper draws on every theme, and what changes is
 * the skill being examined. What it does publish is five themes, each holding
 * the topics printed in bold beneath it, and those are what a student revises
 * -- "holidays", "school activities" -- so the themes are the topics here and
 * their printed topics are the concepts.
 *
 * The board numbers none of them. The references are left empty rather than
 * filled with numbering Pearson does not print.
 */
export const PEARSON_EDEXCEL_GCSE_FRENCH: SpecificationOutline = {
  specificationId: "1FR0",
  idPrefix: "pearson-edexcel-1fr0",
  source:
    "Pearson Edexcel GCSE (9-1) French (1FR0) specification, themes and topics read from the " +
    "published PDF on 2026-09-16: five themes and the topics printed in bold beneath them. " +
    "Pearson numbers neither, so no references are recorded. Not yet checked by a person.",
  groups: [{
    sections: [
      ["", "Identity and culture", [
        ["", "Who am I?"],
        ["", "Daily life"],
        ["", "Cultural life"],
      ]],
      ["", "Local area, holiday and travel", [
        ["", "Holidays"],
        ["", "Travel and tourist transactions"],
        ["", "Town, region and country"],
      ]],
      ["", "School", [
        ["", "What school is like"],
        ["", "School activities"],
      ]],
      ["", "Future aspirations, study and work", [
        ["", "Using languages beyond the classroom"],
        ["", "Ambitions"],
        ["", "Work"],
      ]],
      ["", "International and global dimension", [
        ["", "Bringing the world together"],
        ["", "Environmental issues"],
      ]],
    ],
  }],
};
