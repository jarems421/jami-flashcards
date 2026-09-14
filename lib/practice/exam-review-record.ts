import { schemeCriteria, schemeMarkTotal, type PracticePaperMarkSchemeItem } from "@/lib/practice/mark-schemes";

/**
 * A stored mark scheme, described so a reviewer can check it against a tariff.
 *
 * The reviewer used to be handed every point and every band as one flat list
 * of "criteria" with their marks summed. That is right for an additive scheme
 * and wrong for the two AQA uses most: a pool that lists three acceptable
 * answers for a one-mark question summed to three, and a six-mark levels
 * question summed its levels -- or, since `schemeCriteria` deliberately lists
 * no criteria for a banded scheme, had none at all. On the first two AQA
 * Biology papers that rejected 24 correct questions in 115.
 *
 * So the rule for adding the scheme up travels with it, and the total compared
 * with the tariff is what the scheme can actually award.
 */
export type ExamReviewScheme = {
  regime: PracticePaperMarkSchemeItem["marking"];
  /** How the listed marks combine, in words the reviewer is told to apply. */
  awardRule: string;
  /** The most this scheme can award; this, not a sum of everything listed, is compared with the tariff. */
  schemeAwards: number;
  points?: Array<{ marks: number; text: string }>;
  awardable?: number;
  levels?: Array<{ label: string; marks: string; descriptor: string }>;
  criteria?: Array<{ marks: number; text: string }>;
};

export function examReviewScheme(item: PracticePaperMarkSchemeItem): ExamReviewScheme | null {
  const schemeAwards = schemeMarkTotal(item);
  switch (item.marking) {
    case "additive":
      if (item.points.length === 0) return null;
      return {
        regime: item.marking,
        awardRule: "Every point listed is worth its marks, and they add up.",
        schemeAwards,
        points: item.points.map((point) => ({ marks: point.marks, text: point.text })),
      };
    case "pointPool":
      if (item.points.length === 0) return null;
      return {
        regime: item.marking,
        awardRule: `Any ${item.awardable} of the points listed can be credited. The scheme lists more acceptable answers than it awards on purpose, so do not add every point up.`,
        schemeAwards,
        points: item.points.map((point) => ({ marks: point.marks, text: point.text })),
        awardable: item.awardable,
      };
    case "banded":
      if (item.bands.length === 0) return null;
      return {
        regime: item.marking,
        awardRule: "Levels of response: an answer is placed in one level and given a mark within it. Levels are alternatives, never added together.",
        schemeAwards,
        levels: item.bands.map((band) => ({
          label: band.label,
          marks: band.minMarks === band.maxMarks ? `${band.maxMarks}` : `${band.minMarks}-${band.maxMarks}`,
          descriptor: band.descriptor,
        })),
      };
    default: {
      const criteria = schemeCriteria(item);
      if (criteria.length === 0) return null;
      return {
        regime: item.marking,
        awardRule: "Each criterion is marked up to its stated maximum.",
        schemeAwards,
        criteria: criteria.map((criterion) => ({ marks: criterion.marks, text: criterion.text })),
      };
    }
  }
}
