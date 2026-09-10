import { normalizeOptionalString } from "@/lib/material/content";
import type { PracticePaperGradeGuidance } from "@/lib/practice/practice-papers";

function finiteInteger(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}
/**
 * Grade boundaries, and the percentage they are compared against.
 *
 * Separated from the paper's own shape because it is a different subject: a
 * paper is questions and marks, and this is what a board would have called
 * that mark in a given year. Keeping it here also keeps the flooring rule and
 * the boundary lookup within sight of each other, which is the pairing that
 * has to stay honest.
 */
export function normalizePracticePaperGradeGuidance(
  value: unknown
): PracticePaperGradeGuidance {
  const guidance = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  const normalizeBoundaries = (value: unknown) => Array.isArray(value)
    ? value.slice(0, 20).flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const boundary = candidate as Record<string, unknown>;
        const label = normalizeOptionalString(boundary.label, 80) ?? "";
        if (!label) return [];
        return [{
          label,
          minimumPercentage: Math.max(
            0,
            Math.min(100, finiteInteger(boundary.minimumPercentage))
          ),
        }];
      })
    : [];
  const boundaries = normalizeBoundaries(guidance.boundaries);
  const latest = guidance.latestComparable &&
    typeof guidance.latestComparable === "object"
      ? guidance.latestComparable as Record<string, unknown>
      : null;
  const historical = guidance.historicalMedian &&
    typeof guidance.historicalMedian === "object"
      ? guidance.historicalMedian as Record<string, unknown>
      : null;
  const latestBoundaries = normalizeBoundaries(latest?.boundaries);
  const historicalBoundaries = normalizeBoundaries(historical?.boundaries);
  const primaryBoundaries = boundaries.length > 0 ? boundaries : latestBoundaries;
  const kind = guidance.kind === "official" || guidance.kind === "estimated"
    ? guidance.kind
    : "none";
  return {
    kind: primaryBoundaries.length > 0 ? kind : "none",
    label: normalizeOptionalString(guidance.label, 160) ?? "No grade guidance",
    notice: normalizeOptionalString(guidance.notice, 500) ?? "",
    boundaries: primaryBoundaries.sort(
      (left, right) => right.minimumPercentage - left.minimumPercentage
    ),
    ...(latest && latestBoundaries.length > 0
      ? {
          latestComparable: {
            label:
              normalizeOptionalString(latest.label, 160) ??
              "Latest comparable boundary",
            year: normalizeOptionalString(latest.year, 40) ?? "",
            boundaries: latestBoundaries.sort(
              (left, right) => right.minimumPercentage - left.minimumPercentage
            ),
          },
        }
      : {}),
    ...(historical && historicalBoundaries.length > 0
      ? {
          historicalMedian: {
            label:
              normalizeOptionalString(historical.label, 160) ??
              "Historical median",
            years: normalizeOptionalString(historical.years, 80) ?? "",
            boundaries: historicalBoundaries.sort(
              (left, right) => right.minimumPercentage - left.minimumPercentage
            ),
          },
        }
      : {}),
  };
}

/**
 * A whole-number percentage, always rounded down.
 *
 * Two reasons it is not `Math.round`. A tenth of a percent implies a precision
 * this marking does not have, and rounding up walks a student across a grade
 * boundary they did not reach: 69.6% is not a Grade 7, and no board would give
 * it. `getPracticePaperGradeLabel` compares against this value, so flooring
 * here is what keeps the boundary honest.
 */
export function calculatePracticePaperPercentage(
  awardedMarks: number,
  totalMarks: number
) {
  return totalMarks > 0
    ? Math.max(0, Math.floor((awardedMarks / totalMarks) * 100))
    : 0;
}

export function getPracticePaperGradeLabel(
  percentage: number,
  guidance: PracticePaperGradeGuidance
) {
  return guidance.boundaries.find(
    (boundary) => percentage >= boundary.minimumPercentage
  )?.label;
}
