/**
 * A practice paper's scalar fields: the closed sets a stored value may hold,
 * and the guards that read an unknown value back as one.
 *
 * These live apart from `practice-papers.ts` because they are the one part of
 * the shape with no dependencies at all -- every guard here is a comparison
 * against string literals declared beside it. Keeping them together means a
 * new state for a paper is added in one place, with the check that accepts it
 * from Firestore directly underneath, rather than forty lines of union at the
 * top of a long file and its guard six hundred lines below.
 */

export type PracticePaperOrigin = "generated" | "uploaded";
export type PracticePaperStatus =
  | "setup"
  | "ready"
  | "in_progress"
  | "submitted"
  | "marked";
export type PracticePaperLength = "full";
export type PracticePaperFocus = "balanced" | "weak_areas" | "custom";
export type PracticePaperTimingMode = "timed" | "untimed";
export type PracticePaperTimingState =
  | "not_started"
  | "running"
  | "paused"
  | "awaiting_overtime"
  | "overtime"
  | "submitted";
export type PracticePaperConfidence = "low" | "medium" | "high";
export type PracticePaperMarkSchemeKind =
  | "generated"
  | "official"
  | "estimated"
  | "missing";
export type PracticePaperAssetType =
  | "table"
  | "graph"
  | "diagram"
  | "formula_sheet"
  | "source_extract"
  | "image"
  | "illustration";

export type PracticePaperAssetSource =
  | "deterministic"
  | "generated"
  | "uploaded";
export type PracticePaperAssetValidationStatus =
  | "pending"
  | "valid"
  | "invalid";

export function isConfidence(value: unknown): value is PracticePaperConfidence {
  return value === "low" || value === "medium" || value === "high";
}

export function isStatus(value: unknown): value is PracticePaperStatus {
  return (
    value === "setup" ||
    value === "ready" ||
    value === "in_progress" ||
    value === "submitted" ||
    value === "marked"
  );
}

export function isLength(value: unknown): value is PracticePaperLength {
  return value === "full";
}

export function isTimingMode(value: unknown): value is PracticePaperTimingMode {
  return value === "timed" || value === "untimed";
}

export function isTimingState(value: unknown): value is PracticePaperTimingState {
  return (
    value === "not_started" ||
    value === "running" ||
    value === "paused" ||
    value === "awaiting_overtime" ||
    value === "overtime" ||
    value === "submitted"
  );
}

export function isFocus(value: unknown): value is PracticePaperFocus {
  return value === "balanced" || value === "weak_areas" || value === "custom";
}

export function isMarkSchemeKind(
  value: unknown
): value is PracticePaperMarkSchemeKind {
  return (
    value === "generated" ||
    value === "official" ||
    value === "estimated" ||
    value === "missing"
  );
}

export function isAssetType(value: unknown): value is PracticePaperAssetType {
  return (
    value === "table" ||
    value === "graph" ||
    value === "diagram" ||
    value === "formula_sheet" ||
    value === "source_extract" ||
    value === "image" ||
    value === "illustration"
  );
}

export function isAssetSource(value: unknown): value is PracticePaperAssetSource {
  return value === "deterministic" || value === "generated" || value === "uploaded";
}

export function isAssetValidationStatus(
  value: unknown
): value is PracticePaperAssetValidationStatus {
  return value === "pending" || value === "valid" || value === "invalid";
}
